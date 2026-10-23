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

const require = createRequire(import.meta.url);
const pdfService = require("../../../backend/services/resumePdf");

test("Resume Builder saves and reopens categorized skills and groups preview, downloaded PDF and print", async t => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const artifactRoot = path.resolve(root, "../../tmp/resume-skill-categories");
    await mkdir(artifactRoot, { recursive: true });
    const artifacts = await mkdtemp(path.join(artifactRoot, "run-"));
    t.diagnostic(`Local verification artifacts: ${artifacts}`);
    const result = await build({ stdin: { resolveDir: root, loader: "jsx", contents: `
        import React from 'react';import {createRoot} from 'react-dom/client';
        import 'bootstrap/dist/css/bootstrap.min.css';import './src/index.css';
        import ResumeBuilderPage from './src/pages/ResumeBuilderPage';
        import {buildResumeDocumentHtml} from './src/components/resume/templates/resumeDocumentExport';
        const initial={id:41,title:'Skills Fixture',template_id:'modern-professional',settings:{client_draft_id:'skill-categories',existing_setting:'preserved'},personalInfo:{full_name:'Fixture Graduate',email:'fixture@example.invalid'},summary:{content:'Preserved professional summary'},education:[{institution:'DJEMC',degree:'BSIT'}],skills:[{skill_name:'Problem solving',category:null}],workExperience:[],projects:[],certifications:[],trainings:[],seminars:[],awards:[],organizations:[],volunteerWork:[],languages:[],references:[]};
        if(!localStorage.getItem('fixture-saved-resume'))localStorage.setItem('fixture-saved-resume',JSON.stringify(initial));
        localStorage.setItem('user',JSON.stringify({id:7,name:'Fixture Graduate',email:'fixture@example.invalid',role:'alumni'}));localStorage.setItem('token','fixture-token');
        window.calls=[];window.pdfHtml=[];window.putCount=0;
        window.savedResume=()=>JSON.parse(localStorage.getItem('fixture-saved-resume'));
        window.exportForTemplate=template_id=>buildResumeDocumentHtml({...window.savedResume(),template_id});
        window.fixtureGet=async(url,auth)=>{if(!auth)throw Error('Missing authentication');window.calls.push(url);if(url==='/resumes')return {data:[window.savedResume()]};if(url==='/resumes/41')return window.savedResume();if(url==='/profile')return {id:7,name:'Fixture Graduate',email:'fixture@example.invalid'};throw Error('Unexpected read: '+url);};
        window.fixturePut=async(url,body,auth)=>{if(!auth||url!='/resumes/41')throw Error('Unexpected update');window.putCount++;localStorage.setItem('fixture-saved-resume',JSON.stringify({...body,id:41}));return {data:window.savedResume()};};
        window.fixturePost=async(url,body,auth)=>{if(!auth||url!='/resumes/41/pdf')throw Error('Unexpected write: '+url);window.pdfHtml.push(body.html);const result=await fetch('/fixture-pdf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!result.ok)throw Error(await result.text());return result.blob();};
        createRoot(document.getElementById('root')).render(<ResumeBuilderPage/>);
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
                await writeFile(path.join(artifacts, "categorized-resume.pdf"), pdf);
                res.setHeader("Content-Type", "application/pdf"); return res.end(pdf);
            }
            res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script>');
        } catch (error) { serverErrors.push(error.message); res.statusCode = 500; res.end(error.message); }
    }).listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    // Keep the real backend PDF renderer and its network policy; use pipes for
    // the installed local browser just as the frontend test launcher does.
    const backendPuppeteer = (await import(pathToFileURL(require.resolve("puppeteer", { paths: [path.resolve(root, "../../backend")] })).href)).default;
    const originalLaunch = backendPuppeteer.launch;
    backendPuppeteer.launch = options => originalLaunch.call(backendPuppeteer, { ...options, pipe: true });
    let browser;
    try {
        browser = await puppeteer.launch({ headless: true, pipe: true, executablePath: process.env.PUPPETEER_EXECUTABLE_PATH });
        const page = await browser.newPage(); page.setDefaultTimeout(60000);
        const errors = []; page.on("pageerror", error => errors.push(error.message));
        const base = `http://127.0.0.1:${server.address().port}`;
        await page.setRequestInterception(true);
        page.on("request", request => request.url().startsWith(base + "/") || /^(blob:|data:)/.test(request.url()) ? request.continue() : request.abort());
        await page.setViewport({ width: 1280, height: 1000 });
        await page.goto(base); await page.waitForSelector(".resume-actions-card");
        const click = async text => { const handle=await page.evaluateHandle(text => { const button = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === text && button.getClientRects().length); if (!button) throw Error('Missing button '+text); return button; }, text); await handle.asElement().click(); await handle.dispose(); await settle(); };
        const settle = () => page.evaluate(() => new Promise(requestAnimationFrame));
        const put = async (selector, value) => { await page.$eval(selector, (input, value) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); }, value); await settle(); };
        const addCategory = async name => { await put('[aria-label="New skill category"]', name); await click("Add Category"); };
        const addSkill = async name => { await put('input[placeholder="New skill name"]', name); await click("Add Skill"); };
        const skills = () => page.$$eval('.skills-section input[placeholder="Skill name"]', inputs => inputs.map(input => input.value));
        const move = async (name, category) => { await page.evaluate((name, category) => { const input = [...document.querySelectorAll('.skills-section input[placeholder="Skill name"]')].find(input => input.value === name); const select = input.closest('.resume-skill-row').querySelector('select'); select.value = category; select.dispatchEvent(new Event('change', {bubbles:true})); }, name, category); await settle(); };
        const saved = () => page.evaluate(() => window.savedResume());
        const programming = ["Node.js", "JavaScript", "CSS", "HTML", "React", "Vite", "MySQL"];
        await click("Edit Information");

        await t.test("create custom categories, all requested programming skills, and reject empty/duplicate additions", async () => {
            assert.deepEqual(await skills(), ["Problem solving"]);
            await addCategory("   "); assert.match(await page.$eval('.skills-section [role="alert"]', element => element.textContent), /Enter a category/);
            await addCategory("Programming");
            for (const name of programming) await addSkill(name);
            assert.deepEqual(await page.$$eval('.skill-category', groups => groups.filter(group => group.querySelector('h6')?.textContent === 'Programming').flatMap(group => [...group.querySelectorAll('input[placeholder="Skill name"]')].map(input => input.value))), programming);
            await addSkill(""); assert.match(await page.$eval('.skills-section [role="alert"]', element => element.textContent), /name/);
            await addSkill(" react "); assert.match(await page.$eval('.skills-section [role="alert"]', element => element.textContent), /already exists/);
            assert.equal((await skills()).length, 8);
            await addCategory(" programming "); assert.match(await page.$eval('.skills-section [role="alert"]', element => element.textContent), /already exists/);
            await addCategory("Tools"); await addSkill("Git");
            await addCategory("Empty Category");
            assert.equal((await skills()).length, 9);
        });
        await t.test("invalid edits block saving, and moves/category removal cannot create duplicate skills", async () => {
            const input = await page.$eval('.skills-section input[value="JavaScript"]', input => input.getAttribute('aria-label'));
            const before = await page.evaluate(() => window.putCount);
            await put(`[aria-label="${input}"]`, ""); await click("Save Progress");
            assert.equal(await page.evaluate(() => window.putCount), before);
            assert.match(await page.$eval('.skills-section [role="alert"]', element => element.textContent), /name/);
            await put(`[aria-label="${input}"]`, "JavaScript");
            await page.select('#resume-skill-category','Tools'); await addSkill('React');
            await move('React','Tools');
            assert.match(await page.$eval('.skills-section [role="alert"]', element => element.textContent), /already exists/);
            const remove = async category => { await page.evaluate(category=>{const group=[...document.querySelectorAll('.skill-category')].find(group=>group.querySelector('h6')?.textContent===category);const input=[...group.querySelectorAll('input')].find(input=>input.value==='React');input.closest('.resume-skill-row').querySelector('button').click();},category);await settle();};
            await page.select('#resume-skill-category','');await addSkill('React');
            await page.click('[aria-label="Remove Tools category"]'); await settle();
            assert.match(await page.$eval('.skills-section [role="alert"]', element => element.textContent), /already exists/);
            assert.ok(await page.$('[aria-label="Remove Tools category"]'));
            await remove('Uncategorized');await remove('Tools');
            assert.equal((await skills()).length,9);
        });
        await t.test("recategorize, rename, edit and safely remove categories/skills using existing undo", async () => {
            await addCategory("Database Management"); await move("MySQL", "Database Management");
            await click("Save Progress"); await page.waitForFunction(() => window.savedResume().skills.find(skill => skill.skill_name === 'MySQL')?.category === 'Database Management');
            await page.reload(); await page.waitForSelector(".resume-actions-card"); await click("Edit Information");
            await move("MySQL", "Programming");
            await page.click('[aria-label="Rename Tools category"]'); await put('[aria-label="Rename skill category"]', "Tools and Technologies"); await click("Save Category");
            const javascript = await page.$eval('.skills-section input[value="JavaScript"]', input => input.getAttribute('aria-label'));
            await put(`[aria-label="${javascript}"]`, "JavaScript (ES6)"); await put(`[aria-label="${javascript}"]`, "JavaScript");
            await page.click('[aria-label="Remove Tools and Technologies category"]'); await settle();
            assert.ok((await skills()).includes("Git"));
            assert.ok(await page.$eval('.skills-section', () => [...document.querySelectorAll('.skill-category')].find(group => group.querySelector('h6')?.textContent === 'Uncategorized') && [...[...document.querySelectorAll('.skill-category')].find(group => group.querySelector('h6')?.textContent === 'Uncategorized').querySelectorAll('input')].some(input => input.value === 'Git')));
            await page.click('[aria-label="Undo last change"]'); await settle();
            await page.evaluate(() => { const input=[...document.querySelectorAll('.skills-section input')].find(input=>input.value==='Git');input.closest('.resume-skill-row').querySelector('button').click(); }); await settle();
            assert.equal((await skills()).includes("Git"), false);
            await page.click('[aria-label="Undo last change"]'); await settle();
            await page.click('[aria-label="Remove Database Management category"]'); await settle();
            assert.equal((await skills()).length, 9);
            await click("Save Progress"); await page.waitForFunction(() => document.querySelector('.resume-save-indicator')?.textContent === 'Saved');
            const record = await saved();
            assert.deepEqual(record.skills.filter(skill => skill.category === 'Programming').map(skill => skill.skill_name), programming);
            assert.equal(record.skills.find(skill => skill.skill_name === 'Git').category, 'Tools and Technologies');
            assert.equal(record.settings.existing_setting, 'preserved');
            assert.ok(record.settings.skill_categories.includes('Empty Category'));
            assert.equal(record.summary.content, 'Preserved professional summary');
            assert.equal(record.education[0].institution, 'DJEMC');
        });
        await t.test("reopening keeps assignments, empty categories, and mobile controls within the editor", async () => {
            await page.reload(); await page.waitForSelector(".resume-actions-card"); await click("Edit Information");
            assert.ok(await page.$eval('#resume-skill-category', select => [...select.options].some(option => option.value === 'Empty Category')));
            await page.setViewport({ width: 390, height: 844 });
            const bounds = await page.$$eval('.resume-skill-row input,.resume-skill-row select,.resume-skill-row button', controls => controls.map(control => { const rect=control.getBoundingClientRect();return {left:rect.left,right:rect.right}; }));
            assert.ok(bounds.every(rect => rect.left >= 0 && rect.right <= 391), JSON.stringify(bounds));
            await page.screenshot({ path: path.join(artifacts, "editor-mobile.png"), fullPage: true });
            await page.setViewport({ width: 1280, height: 1000 });
        });
        await t.test("saved preview and every template export have unique, nonempty category headings", async () => {
            await click("Continue to Templates"); await click("Save & Generate Resume"); await page.waitForSelector(".resume-actions-card");
            await page.waitForSelector('.djemc-resume-preview-pages .djemc-resume-skill-category');
            assert.deepEqual(await page.$$eval('.djemc-resume-preview-pages .djemc-resume-skill-category', headings => headings.map(heading => heading.textContent)), ['Programming','Tools and Technologies','Uncategorized']);
            for (const template of ['modern-professional','executive-corporate','university-green','minimal-black-white','creative-professional']) {
                const html = await page.evaluate(template => window.exportForTemplate(template), template);
                assert.equal((html.match(/class="djemc-resume-skill-category"/g)||[]).length, 3, template);
                assert.equal((html.match(/>Programming<\/h3>/g)||[]).length, 1);
                assert.ok(!html.includes('>Empty Category</h3>'));
                for (const name of programming) assert.ok(html.includes('>'+name+'</h3>'), name);
                const document = await browser.newPage();
                await document.setContent(html); await document.emulateMediaType('print');
                const headings = await document.$$eval('.djemc-resume-skill-category', headings => headings.map(heading => ({ text:heading.textContent, width:heading.getBoundingClientRect().width, height:heading.getBoundingClientRect().height })));
                assert.ok(headings.every(heading => heading.width > 0 && heading.height > 0), template);
                if (template === 'modern-professional') await document.screenshot({path:path.join(artifacts,'categorized-preview.png'),fullPage:true});
                await document.close();
            }
        });
        await t.test("real PDF download uses the saved categorized document and printing receives the same grouping", async () => {
            const session = await browser.target().createCDPSession();
            await session.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:artifacts});
            await page.evaluate(()=>{
                window.downloadedFiles=[];
                const click=HTMLAnchorElement.prototype.click;
                HTMLAnchorElement.prototype.click=function(...args){
                    if(this.download&&this.href.startsWith('blob:')){
                        const name=this.download;
                        fetch(this.href).then(result=>result.arrayBuffer()).then(bytes=>window.downloadedFiles.push({name,bytes:[...new Uint8Array(bytes)]}));
                    }
                    return click.apply(this,args);
                };
            });
            await click('Download Resume (PDF)');
            try { await page.waitForFunction(()=>window.downloadedFiles.length===1,{timeout:90000}); }
            catch (error) { throw new Error(`${error.message}; renderer: ${serverErrors.join('; ')}; UI: ${await page.$$eval('.alert-danger', alerts=>alerts.map(alert=>alert.textContent).join('; '))}`); }
            const downloaded=await page.evaluate(()=>window.downloadedFiles[0]);
            assert.equal(downloaded.name,'Skills Fixture.pdf');
            const bytes=Buffer.from(downloaded.bytes);
            assert.deepEqual(bytes,await readFile(path.join(artifacts,'categorized-resume.pdf')));
            await writeFile(path.join(artifacts,'client-download.pdf'),bytes);
            assert.equal(bytes.subarray(0,5).toString(),'%PDF-'); assert.ok(bytes.length>1000);
            assert.equal(await page.evaluate(()=>window.pdfHtml.length),1);
            await page.evaluate(()=>{window.printed=[];const open=window.open.bind(window);window.open=(...args)=>{const popup=open(...args);popup.print=()=>window.printed.push(popup.document.documentElement.outerHTML);return popup;};});
            await click('Print Resume'); await page.waitForFunction(()=>window.printed.length===1);
            const printed = await page.evaluate(()=>window.printed[0]);
            assert.equal((printed.match(/class="djemc-resume-skill-category"/g)||[]).length,3);
            for(const name of programming)assert.ok(printed.includes('>'+name+'</h3>'));
            assert.deepEqual(serverErrors,[]);
        });
        assert.deepEqual(errors, []);
    } finally {
        await browser?.close(); backendPuppeteer.launch=originalLaunch;
        server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve));
    }
});
