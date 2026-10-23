import test from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import puppeteer from "puppeteer";

test("Registrar reviews multi-file and legacy graduation proofs without disrupting account decisions", async () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const expectedProofs = ["Transcript.pdf", "Diploma.png", "Certificate.docx", "Record.pdf", "Graduation.png", "Supporting.pdf"];
    const expectedUrls = Array.from({ length: 6 }, (_, index) => `/api/files/secure/proof-${index}`);
    const result = await build({ stdin: { resolveDir: root, loader: "jsx", contents: `
        import React from 'react';import {createRoot} from 'react-dom/client';import {MemoryRouter} from 'react-router-dom';
        import Queue from './src/pages/RegistrarVerificationQueuePage';
        const documents=[
            {name:'Transcript.pdf',url:'/api/files/secure/proof-0',mime_type:'application/pdf'},
            {name:'Diploma.png',url:'/api/files/secure/proof-1',mime_type:'image/png'},
            {name:'Certificate.docx',url:'/api/files/secure/proof-2',mime_type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'},
            {name:'Record.pdf',url:'/api/files/secure/proof-3',mime_type:'application/pdf'},
            {name:'Graduation.png',url:'/api/files/secure/proof-4',mime_type:'image/png'},
            {name:'Supporting.pdf',url:'/api/files/secure/proof-5',mime_type:'application/pdf'}
        ];
        const record={id:7,full_name:'Fixture Alumni',student_id:'R-7',course:'BSIT',batch_year:2024};
        const query=new URLSearchParams(location.search);const legacy=query.has('legacy');const legacyImage=query.get('legacy')==='image';const broken=query.has('broken');
        const shown=legacy?[{...documents[legacyImage?1:0],url:'/api/files/secure/legacy',name:legacyImage?'Legacy.png':'Legacy.pdf'}]:documents.slice(0,Number(query.get('count')||6));
        window.reads=[];window.downloads=[];window.actions=[];
        HTMLAnchorElement.prototype.click=function(){window.downloads.push({name:this.download,url:this.href});};
        localStorage.setItem('user',JSON.stringify({id:101,role:'admin',admin_scope:'registrar'}));localStorage.setItem('token','fixture-token');
        window.fixtureGet=async url=>url==='/users/pending'?[{id:81,name:'Fixture Alumni',email:'fixture@gmail.com',account_status:'pending',AlumniProfile:{course:'BSIT',graduation_year:2024,proof_document_url:shown[0].url,proof_document_name:shown[0].name,...(!legacy?{proof_documents:shown}:{})}}]:url.startsWith('/alumni-records/search')?[record]:url==='/alumni-records'?[record]:[];
        window.fixturePut=async url=>{window.actions.push(url);return {ok:true};};
        window.fixtureFile=async url=>{window.reads.push(url);if(broken&&url.includes('proof-5'))throw Error('The uploaded document could not be found.');const selected=shown.find(doc=>doc.url===url)||documents.find(doc=>doc.url===url);if(!selected)throw Error('Unauthorized or unknown file');if(selected.mime_type==='image/png')return new Blob([new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,6,0,0,0,31,21,196,137,0,0,0,13,73,68,65,84,8,215,99,96,96,248,15,0,1,4,1,0,95,85,57,177,0,0,0,0,73,69,78,68,174,66,96,130])]);if(selected.mime_type==='image/jpeg')return new Blob([new Uint8Array([255,216,255,224,0,16,74,70,73,70,0,1,1,0,0,1,0,1,0,0,255,217])]);if(selected.mime_type.includes('wordprocessingml'))return new Blob([new Uint8Array([80,75,3,4,20,0,0,0])]);return new Blob(['%PDF-1.7 fixture '+url]);};
        createRoot(document.getElementById('root')).render(<MemoryRouter><Queue/></MemoryRouter>);
    ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "import.meta.env": "{}", "process.env.NODE_ENV": '"test"' }, plugins: [{ name: "fixtures", setup(builder) {
        builder.onResolve({ filter: /css/ }, () => ({ path: "css", namespace: "fixture" }));
        builder.onLoad({ filter: /^css$/, namespace: "fixture" }, () => ({ contents: "export default function cssFixture() {}" }));
        builder.onResolve({ filter: /api/ }, () => ({ path: "api", namespace: "fixture" }));
        builder.onLoad({ filter: /^api$/, namespace: "fixture" }, () => ({ contents: "export const API_BASE_URL='http://fixture.invalid/api';export const resolveFileUrl=value=>value||'';export const fetchFile=(...args)=>window.fixtureFile(...args);export const api={get:(...args)=>window.fixtureGet(...args),put:(...args)=>window.fixturePut(...args),post:()=>{throw Error('Unexpected write');}};" }));
    } }], logLevel: "silent" });
    const server = createServer((req, res) => {
        if (req.url === "/fixture.js") { res.setHeader("Content-Type", "text/javascript"); res.end(result.outputFiles[0].text); }
        else res.end('<!doctype html><div id="root"></div><script src="/fixture.js"></script>');
    }).listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    let browser;
    try {
        browser = await puppeteer.launch({ headless: true, pipe: true, executablePath: process.env.PUPPETEER_EXECUTABLE_PATH, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
        const page = await browser.newPage();
        page.setDefaultTimeout(8000);
        const errors = []; page.on("pageerror", error => errors.push(error.message));
        const base = `http://127.0.0.1:${server.address().port}`;
        await page.setRequestInterception(true);
        page.on("request", request => request.url().startsWith(base) || request.url().startsWith("blob:") ? request.continue() : request.abort());
        await page.goto(base);
        await page.waitForSelector(".rvq-row-actions button");
        await page.click(".rvq-row-actions button");
        await page.evaluate(() => [...document.querySelectorAll("button")].find(button => button.textContent.startsWith("View Document")).click());
        await page.waitForSelector(".rvq-proof-file-actions");
        assert.equal(await page.$$eval(".rvq-proof-list li", rows => rows.length), 6);
        assert.deepEqual(await page.$$eval(".rvq-proof-file-details strong", names => names.map(item => item.textContent)), expectedProofs);
        assert.deepEqual(await page.$$eval(".rvq-proof-file-details span", labels => labels.map(item => item.textContent)), ["PDF", "PNG", "DOCX", "PDF", "PNG", "PDF"]);
        for (let index = 0; index < 6; index++) {
            const row = `.rvq-proof-list li:nth-child(${index + 1})`;
            await page.click(`${row} .rvq-proof-file-actions button:first-child`);
            const mime = ["application/pdf", "image/png", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/pdf", "image/png", "application/pdf"][index];
            if (mime === "application/pdf") await page.waitForFunction(name => document.querySelector(".rvq-proof-preview iframe")?.title === name, {}, expectedProofs[index]);
            else if (mime.startsWith("image/")) {
                await page.waitForFunction(name => document.querySelector(".rvq-proof-preview img")?.alt === name, {}, expectedProofs[index]);
                if (index === 1) {
                    await page.click(".rvq-proof-preview button");
                    await page.waitForFunction(() => document.querySelector(".rvq-proof-preview button")?.textContent === "Fit image");
                    await page.click(".rvq-proof-preview button");
                }
            }
            else await page.waitForFunction(() => document.querySelector(".rvq-proof-preview")?.textContent.includes("Inline preview is unavailable"));
            await page.click(`${row} .rvq-proof-file-actions button:last-child`);
            await page.waitForFunction(name => window.downloads.some(file => file.name === name), {}, expectedProofs[index]);
        }
        assert.deepEqual(await page.evaluate(() => [...new Set(window.reads)].sort()), expectedUrls.sort());
        assert.equal(await page.$$eval(".rvq-proof-list li", rows => rows.some(row => row.textContent.includes("undefined"))), false);

        for (const count of [1, 2, 4]) {
            await page.goto(base + `/?count=${count}`);
            await page.waitForSelector(".rvq-row-actions button");
            await page.click(".rvq-row-actions button");
            await page.evaluate(() => [...document.querySelectorAll("button")].find(button => button.textContent.startsWith("View Document")).click());
            await page.waitForSelector(".rvq-proof-file-actions");
            assert.equal(await page.$$eval(".rvq-proof-list li", rows => rows.length), count);
            assert.equal(await page.$(".rvq-proof-empty"), null);
            await page.click(".rvq-proof-modal .btn-close");
            await page.waitForSelector(".rvq-proof-modal", { hidden: true });
        }

        await page.evaluate(() => [...document.querySelectorAll("button")].find(button => button.textContent.startsWith("View Document")).click());
        await page.waitForSelector(".rvq-proof-file-actions");
        await page.setViewport({ width: 390, height: 844 });
        assert.equal(await page.evaluate(() => {
            const dialog = document.querySelector(".rvq-proof-modal");
            const body = dialog?.querySelector(".modal-body");
            const viewer = dialog?.querySelector(".rvq-proof-viewer");
            return !!dialog && dialog.getBoundingClientRect().right <= innerWidth && body.scrollWidth <= body.clientWidth + 1 && viewer.scrollWidth <= viewer.clientWidth + 1;
        }), true);
        await page.click(".rvq-proof-modal .btn-close");
        await page.waitForSelector(".rvq-proof-modal", { hidden: true });
        const approve = page.waitForFunction(() => window.actions.some(action => action.endsWith("/approve")));
        await page.waitForSelector(".search-result-item");
        await page.click(".search-result-item");
        await page.click(".rvq-review-actions .btn-success");
        await approve;
        await page.waitForSelector(".rvq-row-actions button");
        await page.click(".rvq-row-actions button");
        await page.click(".rvq-review-actions .btn-outline-danger");
        await page.waitForFunction(() => window.actions.some(action => action.endsWith("/reject")));

        for (const kind of ["pdf", "image"]) {
            await page.goto(base + `/?legacy=${kind}`);
            await page.waitForSelector(".rvq-row-actions button");
            await page.click(".rvq-row-actions button");
            await page.evaluate(() => [...document.querySelectorAll("button")].find(button => button.textContent.startsWith("View Document")).click());
            assert.equal(await page.$$eval(".rvq-proof-list li", rows => rows.length), 1);
            if (kind === "pdf") await page.waitForSelector(".rvq-proof-preview iframe");
            else await page.waitForSelector(".rvq-proof-preview img");
            await page.waitForSelector(".rvq-proof-preview .document-preview");
        }

        await page.goto(base + "/?broken");
        await page.waitForSelector(".rvq-row-actions button");
        await page.click(".rvq-row-actions button");
        await page.evaluate(() => [...document.querySelectorAll("button")].find(button => button.textContent.startsWith("View Document")).click());
        await page.click(".rvq-proof-list li:nth-child(6) .rvq-proof-file-actions button:first-child");
        await page.waitForSelector(".rvq-proof-preview .alert-danger");
        assert.deepEqual(errors, []);
    } finally {
        await browser?.close(); await new Promise(resolve => server.close(resolve));
    }
});
