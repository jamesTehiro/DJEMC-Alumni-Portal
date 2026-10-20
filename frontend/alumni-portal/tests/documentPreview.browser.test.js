import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import puppeteer from "puppeteer";

test("shared viewer previews protected chat/registration files, downloads Office files and releases object URLs", async () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const streams = [1, 2].map(page => `BT /F1 20 Tf 30 300 Td (Original document - page ${page}) Tj ET`);
    const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
        ...[5, 6].map(content => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 360 480] /Resources << /Font << /F1 7 0 R >> >> /Contents ${content} 0 R >>`),
        ...streams.map(stream => `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`),
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
    ];
    let pdf = '%PDF-1.7\n';
    const offsets = [0];
    objects.forEach((object, index) => { offsets.push(pdf.length); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
    const xref = pdf.length;
    pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n ').join('\n')}\ntrailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    const result = await build({ stdin: { resolveDir: root, loader: "jsx", contents: `
        import React from 'react'; import {createRoot} from 'react-dom/client';
        import DocumentPreview from './src/components/DocumentPreview';
        import MessageAttachment from './src/components/MessageAttachment';
        import GraduationProofPreview from './src/components/GraduationProofPreview';
        import BusinessPermitPreview from './src/components/BusinessPermitPreview';
        window.released=[]; const revoke=URL.revokeObjectURL.bind(URL);URL.revokeObjectURL=url=>{window.released.push(url);revoke(url);};
        window.reads=[];window.downloads=[];
        const png=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='),c=>c.charCodeAt(0));
        window.fixtureFile=async(path,auth)=>{if(!auth)throw Error('Missing authorization');window.reads.push(path);if(path==='missing')throw Error('The uploaded document could not be found.');return path==='image'?new Blob([png],{type:'image/png'}):path==='office'?new Blob([new Uint8Array([80,75,3,4,1,2])],{type:'application/octet-stream'}):new Blob([${JSON.stringify(pdf)}],{type:'image/png'});};
        const root=createRoot(document.getElementById('root'));
        window.show=(mode)=>root.render(mode==='none'?null:mode==='registrar'?<GraduationProofPreview path="pdf" name="Graduation.pdf"/>:mode==='permit'?<BusinessPermitPreview name="Permit.pdf" request={window.fixtureFile('pdf',true).then(blob=>({blob}))}/>:mode==='chat'?<MessageAttachment message={{id:1,file_url:'pdf',file_name:'Chat.pdf',file_mime:'application/pdf'}} openAttachment={(m,action)=>window.downloads.push(action)}/>:<DocumentPreview path={mode} name={mode==='office'?'Original.docx':'Original.png'}/>);
        window.show('registrar');
    ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "import.meta.env": "{}", "process.env.NODE_ENV": '"test"' }, plugins: [{ name: "fixture-api", setup(builder) {
        builder.onResolve({ filter: /\/services\/api$/ }, () => ({ path: "api", namespace: "fixture" }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export const fetchFile=(...args)=>window.fixtureFile(...args);" }));
    } }], logLevel: "silent" });
    const server = createServer((req, res) => {
        if (req.url === "/bundle.js") { res.setHeader("Content-Type", "text/javascript"); res.end(result.outputFiles[0].text); }
        else if (req.url === '/bootstrap.css') { res.setHeader('Content-Type', 'text/css'); res.end(readFileSync(path.join(root, 'node_modules/bootstrap/dist/css/bootstrap.min.css'))); }
        else res.end('<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/bootstrap.css"><div id="root"></div><script src="/bundle.js"></script>');
    }).listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    let browser;
    try {
        console.log('Viewer fixture built; launching local Chrome.');
        browser = await puppeteer.launch({ headless: true, pipe: true, timeout: 15000, executablePath: process.env.PUPPETEER_EXECUTABLE_PATH });
        console.log('Chrome launched; opening viewer fixture.');
        const page = await browser.newPage();
        const errors = []; page.on("pageerror", error => errors.push(error.message));
        await page.goto(`http://127.0.0.1:${server.address().port}`);
        console.log('Viewer fixture opened.');
        for (const mode of ["registrar", "permit"]) {
            await page.evaluate(mode => window.show(mode), mode);
            await page.waitForSelector("iframe");
            assert.equal(await page.$eval("iframe", frame => frame.src.startsWith("blob:")), true);
            assert.equal(await page.$eval("iframe", frame => frame.style.height), "70vh");
            assert.equal(await page.$eval('iframe', async frame => (await (await fetch(frame.src)).text()).includes('/Count 2')), true);
            assert.equal(await page.$$("img").then(items => items.length), 0);
            await page.setViewport({ width: 375, height: 812 });
            assert.equal(await page.$eval("iframe", frame => frame.getBoundingClientRect().width <= 375), true);
            if (mode === 'registrar') await page.screenshot({ path: path.join(root, '../../tmp/attachment-preview-mobile.png'), fullPage: true });
            await page.evaluate(() => window.show('none'));
            await page.waitForFunction(() => !document.querySelector('iframe'));
        }
        await page.evaluate(() => window.show('chat'));
        await page.waitForSelector('.attachment-action');
        await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent === 'Open').click());
        await page.waitForSelector('iframe');
        await page.evaluate(() => document.querySelector('.btn-close').click());
        await page.waitForFunction(() => !document.querySelector('iframe'));
        await page.evaluate(() => window.show('image'));
        await page.waitForSelector('img');
        await page.waitForFunction(() => document.querySelector('img')?.naturalWidth > 0);
        await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent === 'Enlarge image').click());
        assert.equal(await page.$eval('img', image => image.style.maxWidth), 'none');
        await page.evaluate(() => window.show('office'));
        await page.waitForSelector('a[download="Original.docx"]');
        assert.equal(await page.$$('iframe,img').then(items => items.length), 0);
        await page.evaluate(() => window.show('missing'));
        await page.waitForSelector('[role="alert"]');
        assert.match(await page.$eval('[role="alert"]', element => element.textContent), /could not be found/);
        assert.ok(await page.evaluate(() => window.released.length >= 5));
        assert.deepEqual(errors, []);
    } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
});
