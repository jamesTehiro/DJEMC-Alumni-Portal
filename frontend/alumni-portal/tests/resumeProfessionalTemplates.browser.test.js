import test from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import { Buffer } from "node:buffer";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFile, writeFile, mkdir, mkdtemp } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import { RESUME_TEMPLATE_OPTIONS } from "../src/features/resumes/templates/resumeTemplateConfig.js";
import { createResumeSections } from "../src/features/resumes/templates/resumeTemplateData.js";
import { resumeScenarios } from "./fixtures/resumeProfessionalFixtures.js";

const require = createRequire(import.meta.url);
const pdfService = require("../../../backend/services/resumePdf");
const templates = RESUME_TEMPLATE_OPTIONS.slice(5);

test("professional resume collection: live selection, content, pagination, mobile, save/reopen, PDF and print", async t => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const artifactRoot = path.resolve(root, "../../tmp/resume-professional-templates");
    await mkdir(artifactRoot, { recursive: true });
    const artifacts = await mkdtemp(path.join(artifactRoot, "run-"));
    t.diagnostic(`Local verification artifacts: ${artifacts}`);
    const result = await build({ stdin: { resolveDir: root, loader: "jsx", contents: `
        import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
        import 'bootstrap/dist/css/bootstrap.min.css';
        import ResumeBuilderPage from './src/features/resumes/pages/ResumeBuilderPage';
        import TemplateSelector from './src/features/resumes/components/TemplateSelector';
        import ResumePreview from './src/features/resumes/components/ResumePreview';
        import {buildResumeDocumentHtml} from './src/features/resumes/templates/resumeDocumentExport';
        import {resumeScenarios} from './tests/fixtures/resumeProfessionalFixtures';
        localStorage.setItem('user',JSON.stringify({id:7,name:'Alex Dela Cruz',email:'alex@example.invalid',role:'alumni'}));localStorage.setItem('token','fixture-token');
        if(!localStorage.getItem('fixture-resume'))localStorage.setItem('fixture-resume',JSON.stringify(resumeScenarios.bsit));
        window.savedResume=()=>JSON.parse(localStorage.getItem('fixture-resume'));
        window.requests=[];window.pdfHtml=[];window.printed=[];
        window.fixtureGet=async(url,auth)=>{if(!auth)throw Error('Missing authentication');window.requests.push(['GET',url]);if(url==='/resumes')return {data:[window.savedResume()]};if(url==='/resumes/41')return window.savedResume();if(url==='/profile')return {id:7,name:'Alex Dela Cruz',email:'alex@example.invalid'};throw Error('Unexpected read '+url);};
        window.fixturePut=async(url,body,auth)=>{if(!auth||url!='/resumes/41')throw Error('Unexpected update');window.requests.push(['PUT',url,body]);localStorage.setItem('fixture-resume',JSON.stringify({...body,id:41}));return {data:window.savedResume()};};
        window.fixturePost=async(url,body,auth)=>{if(!auth||url!='/resumes/41/pdf')throw Error('Unexpected write '+url);window.pdfHtml.push(body);const res=await fetch('/fixture-pdf',{method:'POST',body:JSON.stringify(body)});if(!res.ok)throw Error(await res.text());return res.blob();};
        window.open=()=>({document:{images:[],fonts:{ready:Promise.resolve()},open(){},write(html){this.html=html;},close(){}},focus(){},print(){window.printed.push(this.document.html);},close(){}});
        function Gallery(){const [resume,setResume]=useState(resumeScenarios.graduate);window.currentResume=resume;window.setFixture=(name,template_id)=>setResume({...resumeScenarios[name],template_id});window.exportResume=()=>buildResumeDocumentHtml(window.currentResume);return <main style={{maxWidth:1100,margin:'auto',padding:12}}><TemplateSelector resume={resume} currentTemplate={resume.template_id} onSelect={template_id=>setResume({...resume,template_id})}/><ResumePreview resume={resume}/></main>;}
        createRoot(document.getElementById('root')).render(location.pathname==='/builder'?<ResumeBuilderPage/>:<Gallery/>);
    ` }, bundle: true, write: false, outdir: "fixture", platform: "browser", format: "iife", jsx: "automatic", define: { "import.meta.env": "{}", "process.env.NODE_ENV": '"test"' }, plugins: [{ name: "fixtures", setup(builder) {
        builder.onResolve({ filter: /\.css\?raw$/ }, args => ({ path: path.resolve(args.resolveDir, args.path.replace(/\?raw$/, "")), namespace: "raw-css" }));
        builder.onLoad({ filter: /.*/, namespace: "raw-css" }, async args => ({ contents: `export default ${JSON.stringify(await readFile(args.path, "utf8"))};` }));
        builder.onResolve({ filter: /\/services\/api$/ }, () => ({ path: "api", namespace: "fixture" }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export const API_BASE_URL=location.origin+'/api';export const resolveFileUrl=value=>value||'';export const api={get:(...args)=>window.fixtureGet(...args),put:(...args)=>window.fixturePut(...args),post:(...args)=>window.fixturePost(...args)};" }));
    } }], logLevel: "silent" });
    const bundle = result.outputFiles.find(file => file.path.endsWith(".js")).text;
    const css = result.outputFiles.find(file => file.path.endsWith(".css")).text.replace(/@import[^;]+;/g, "");
    const serverErrors = [];
    const server = createServer(async (req, res) => {
        try {
            if (req.url === "/fixture.js") { res.setHeader("Content-Type", "text/javascript"); return res.end(bundle); }
            if (req.url === "/fixture.css") { res.setHeader("Content-Type", "text/css"); return res.end(css); }
            if (req.url === "/fixture-pdf") {
                const chunks = []; for await (const chunk of req) chunks.push(chunk);
                const body = JSON.parse(Buffer.concat(chunks).toString());
                pdfService.validateResumeHtml(body.html, 41, body.template_id);
                const pdf = await pdfService.renderResumePdf(body.html);
                await writeFile(path.join(artifacts, `${body.template_id}.pdf`), pdf);
                res.setHeader("Content-Type", "application/pdf"); return res.end(pdf);
            }
            res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><style>html,body{margin:0}</style><div id="root"></div><script src="/fixture.js"></script>');
        } catch (error) { serverErrors.push(error.message); res.statusCode = 500; res.end(error.message); }
    }).listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    const backendPuppeteer = (await import(pathToFileURL(require.resolve("puppeteer", { paths: [path.resolve(root, "../../backend")] })).href)).default;
    const originalLaunch = backendPuppeteer.launch;
    backendPuppeteer.launch = options => originalLaunch.call(backendPuppeteer, { ...options, pipe: true });
    let browser;
    try {
        browser = await puppeteer.launch({ headless: true, pipe: true, executablePath: process.env.PUPPETEER_EXECUTABLE_PATH });
        const page = await browser.newPage(); page.setDefaultTimeout(60000);
        const downloadSession = await browser.target().createCDPSession();
        await downloadSession.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: artifacts });
        const errors = []; page.on("pageerror", error => errors.push(error.message));
        const base = `http://127.0.0.1:${server.address().port}`;
        await page.setRequestInterception(true);
        page.on("request", request => request.url().startsWith(base + "/") || /^(blob:|data:)/.test(request.url()) ? request.continue() : request.abort());
        await page.setViewport({ width: 1280, height: 1000 });
        await page.goto(base); await page.waitForSelector('.djemc-resume-preview-pages .djemc-resume-page');
        const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const click = async text => {
            const handle = await page.evaluateHandle(text => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === text && button.getClientRects().length), text);
            assert.ok(handle.asElement(), `Missing button ${text}`); await handle.asElement().click(); await handle.dispose(); await settle();
        };
        const exported = {};
        await t.test("all eleven gallery cards select immediately without changing entered information", async () => {
            assert.equal(await page.$$eval('[role="radio"]', cards => cards.length), 11);
            const before = await page.evaluate(() => window.currentResume);
            for (const template of RESUME_TEMPLATE_OPTIONS) {
                await page.click(`[role="radio"][aria-label^="${template.name}."]`); await settle();
                const after = await page.evaluate(() => window.currentResume);
                assert.deepEqual({ ...after, template_id: before.template_id }, before);
                assert.equal(after.template_id, template.id);
                assert.equal(await page.$eval('[role="radio"][aria-checked="true"] .djemc-template-select-label', label => label.textContent), "Selected Template");
                assert.equal(await page.$eval('.djemc-resume-preview-pages article', article => article.dataset.templateId), template.id);
            }
        });
        for (const template of templates) {
            for (const [name, resume] of Object.entries(resumeScenarios)) await t.test(`${template.name}: ${name} content and A4 page boundaries`, async () => {
                await page.evaluate((name, id) => window.setFixture(name, id), name, template.id); await settle();
                assert.equal(await page.$('.djemc-resume-preview .alert-danger'), null);
                const preview = await page.$$eval('.djemc-resume-preview-pages article', pages => pages.map(page => page.innerHTML));
                const html = await page.evaluate(() => window.exportResume());
                const document = await browser.newPage();
                try {
                    await document.setContent(html); await document.emulateMediaType('print');
                    const result = await document.evaluate(() => ({
                        pages: [...document.querySelectorAll('article')].map(page => page.innerHTML),
                        sections: [...new Set([...document.querySelectorAll('[data-section-id]')].map(section => section.dataset.sectionId))],
                        descriptions: [...document.querySelectorAll('.djemc-resume-entry-description')].map(part => part.textContent).join(''),
                        bounds: [...document.querySelectorAll('article')].map(page => {
                            const box = page.getBoundingClientRect(); const style = getComputedStyle(page); const body = page.querySelector('.djemc-resume-body').getBoundingClientRect();
                            const outside = [...page.querySelectorAll('h1,h2,h3,p,.djemc-resume-photo')].filter(node => { const rect = node.getBoundingClientRect(); return rect.width && (rect.left < box.left - 1 || rect.right > box.right + 1 || rect.bottom > box.bottom - parseFloat(style.paddingBottom) + 1); }).map(node => node.textContent);
                            return { width: box.width, height: box.height, bottom: body.bottom, allowedBottom: box.bottom - parseFloat(style.paddingBottom), outside };
                        })
                    }));
                    assert.equal(result.pages.length, preview.length, "Print/PDF page count must match the live preview");
                    result.pages.forEach((html, index) => assert.ok(html === preview[index], `Print/PDF content must match preview page ${index + 1}`));
                    const sections = createResumeSections(resume);
                    assert.deepEqual([...result.sections].sort(), sections.map(section => section.id).sort());
                    assert.equal(result.descriptions, (template.sectionOrder ? [...sections].sort((a,b) => template.sectionOrder.indexOf(a.id)-template.sectionOrder.indexOf(b.id)) : sections).flatMap(section => section.items.map(item => item.description || '')).join(''));
                    assert.ok(result.bounds.every(box => Math.abs(box.width - 793.7) < 1 && Math.abs(box.height - 1122.52) < 1 && box.bottom <= box.allowedBottom + 1 && !box.outside.length), JSON.stringify(result.bounds));
                    if (name === "extended" || name === "learning") assert.ok(result.pages.length >= 2);
                    if (name === "graduate") {
                        assert.ok(!result.sections.includes("workExperience"));
                        await document.screenshot({ path: path.join(artifacts, `${template.id}.png`), clip: { x: 0, y: 0, width: 794, height: 1123 } });
                    }
                    if (name === "extended") exported[template.id] = { html, pages: result.pages.length };
                    if (name === "empty") assert.deepEqual(result.sections, []);
                } finally { await document.close(); }
            });
        }
        await t.test("A4 preview and gallery fit 320px, 375px and desktop without horizontal scrolling", async () => {
            for (const width of [320, 375, 1280]) {
                await page.setViewport({ width, height: 950 });
                for (const template of templates) {
                    await page.evaluate(id => window.setFixture('bsit', id), template.id); await settle();
                    const result = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, bounds: [...document.querySelectorAll('.djemc-resume-preview-page-shell')].map(node => { const rect=node.getBoundingClientRect(); return [rect.left,rect.right]; }) }));
                    assert.ok(result.width <= width + 1 && result.bounds.every(([left,right]) => left >= 0 && right <= width + 1), `${template.id}, ${width}: ${JSON.stringify(result)}`);
                }
                if (width === 320) await page.screenshot({ path: path.join(artifacts, 'gallery-mobile.png'), fullPage: true });
            }
        });
        await t.test("every existing saved design reopens; all six new designs save, reopen, download a real PDF and print", async () => {
            await page.goto(base + '/builder'); await page.waitForSelector('.resume-actions-card');
            assert.equal(await page.$eval('.djemc-resume-preview-pages article', article => article.dataset.templateId), 'modern-professional');
            const original = await page.evaluate(() => window.savedResume());
            for (const template of RESUME_TEMPLATE_OPTIONS.slice(0, 5)) {
                await page.evaluate(id => { const saved=window.savedResume();localStorage.setItem('fixture-resume',JSON.stringify({...saved,template_id:id}));localStorage.removeItem('djemc-resume-draft-7'); }, template.id);
                await page.reload(); await page.waitForSelector('.resume-actions-card');
                assert.equal(await page.$eval('.djemc-resume-preview-pages article', article => article.dataset.templateId), template.id);
            }
            for (const template of templates) {
                await click('Change Template');
                await page.click(`[role="radio"][aria-label^="${template.name}."]`); await settle();
                await click('Save & Generate Resume'); await page.waitForSelector('.resume-actions-card');
                const saved = await page.evaluate(() => window.savedResume());
                assert.equal(saved.template_id, template.id);
                assert.deepEqual({ ...saved, template_id: original.template_id }, original);
                await page.reload(); await page.waitForSelector('.resume-actions-card');
                assert.equal(await page.$eval('.djemc-resume-preview-pages article', article => article.dataset.templateId), template.id);
                await click('Print Resume'); await page.waitForFunction(() => window.printed.length === 1);
                const printed = await page.evaluate(() => window.printed[0]);
                assert.ok(printed.includes(`data-template-id="${template.id}"`));
                // Exercise the real download handler and backend renderer with this saved design.
                await click('Download Resume (PDF)');
                try {
                    await page.waitForFunction(() => window.pdfHtml.length === 1 && ![...document.querySelectorAll('button')].some(button => button.textContent.includes('Preparing document')), { polling: 100, timeout: 120000 });
                } catch (error) {
                    throw new Error(`${template.id}: ${error.message}; renderer: ${serverErrors.join('; ')}; UI: ${await page.$$eval('.alert-danger', nodes => nodes.map(node => node.textContent).join('; '))}; requests: ${await page.evaluate(() => window.pdfHtml.length)}`);
                }
                assert.deepEqual(await page.$$eval('.alert-danger', nodes => nodes.map(node => node.textContent)), []);
                const downloadedHtml = await page.evaluate(() => window.pdfHtml[0].html);
                assert.equal(downloadedHtml, printed);
                const pdf = await readFile(path.join(artifacts, `${template.id}.pdf`));
                assert.equal(pdf.subarray(0,5).toString(), '%PDF-');
                // Also render detailed multi-page content through the unchanged backend PDF service.
                pdfService.validateResumeHtml(exported[template.id].html, 41, template.id);
                const longPdf = await pdfService.renderResumePdf(exported[template.id].html);
                await writeFile(path.join(artifacts, `${template.id}-extended.pdf`), longPdf);
                const pdfText = longPdf.toString('latin1');
                assert.equal([...pdfText.matchAll(/\/Type\s*\/Page\b/g)].length, exported[template.id].pages, template.id);
                const boxes = [...pdfText.matchAll(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g)];
                assert.ok(boxes.length > 0 && boxes.every(box => Math.abs(Number(box[1])/Number(box[2]) - 210/297) < 0.003));
                process.stdout.write(`# Verified ${template.id}: saved selection, real PDF download, multi-page PDF and print\n`);
            }
        });
        await writeFile(path.join(artifacts, 'pagination.json'), JSON.stringify(Object.fromEntries(Object.entries(exported).map(([id, value]) => [id, value.pages])), null, 2));
        assert.deepEqual(serverErrors, []); assert.deepEqual(errors, []);
    } finally {
        await browser?.close(); backendPuppeteer.launch = originalLaunch;
        server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve));
    }
});
