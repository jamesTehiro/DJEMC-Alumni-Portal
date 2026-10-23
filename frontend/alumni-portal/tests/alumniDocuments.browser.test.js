import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import process from "node:process";

test("both alumni forms handle batches, removal/replacement, invalid files, submission and optional attachments", async t => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const result = await build({ stdin: { resolveDir: root, loader: "jsx", contents: `
        import React from 'react'; import {createRoot} from 'react-dom/client'; import {MemoryRouter} from 'react-router-dom';
        import RegisterPage from './src/pages/RegisterPage'; import AlumniRegisterPage from './src/pages/AlumniRegisterPage';
        window.submissions=[];
        window.fixturePost=async(url,body)=>{if(url!='/auth/register')throw Error('Unexpected API');const fields=body instanceof FormData?[...body.entries()]:Object.entries(body);window.submissions.push(await Promise.all(fields.map(async([name,value])=>[name,value instanceof File?{name:value.name,body:await value.text()}:value])));return {};};
        createRoot(document.getElementById('root')).render(<MemoryRouter>{location.pathname==='/legacy'?<RegisterPage/>:<AlumniRegisterPage/>}</MemoryRouter>);
    ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "import.meta.env": '{"VITE_MAX_UPLOAD_MB":"1"}', "process.env.NODE_ENV": '"test"' }, plugins: [{ name: "fixtures", setup(builder) {
        builder.onResolve({ filter: /\.css$/ }, () => ({ path: "css", namespace: "fixture" }));
        builder.onLoad({ filter: /^css$/, namespace: "fixture" }, () => ({ contents: "export default {};" }));
        builder.onResolve({ filter: /\/services\/api$/ }, () => ({ path: "api", namespace: "fixture" }));
        builder.onLoad({ filter: /^api$/, namespace: "fixture" }, () => ({ contents: "export const api={post:(...args)=>window.fixturePost(...args)};" }));
        builder.onResolve({ filter: /\/hooks\/useRegistrationOtp$/ }, () => ({ path: "otp", namespace: "fixture" }));
        builder.onLoad({ filter: /^otp$/, namespace: "fixture" }, () => ({ contents: "export const readRegistrationSession=()=>null;export default ()=>({verified:true,session:{email:'fixture@gmail.com',token:'fixture-session'},details:{registration_authorization:'fixture-authorization'},clear:()=>{},open:false,busy:false});" }));
    } }], logLevel: "silent" });
    const server = createServer((req, res) => {
        if (req.url === "/fixture.js") { res.setHeader("Content-Type", "text/javascript"); res.end(result.outputFiles[0].text); }
        else res.end('<!doctype html><div id="root"></div><script src="/fixture.js"></script>');
    }).listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    let browser;
    try {
        browser = await puppeteer.launch({ headless: true, pipe: true, executablePath: process.env.PUPPETEER_EXECUTABLE_PATH });
        for (const route of ["/legacy", "/active"]) await t.test(route, async () => {
            const page = await browser.newPage();
            const errors = []; page.on("pageerror", error => errors.push(error.message));
            const url = `http://127.0.0.1:${server.address().port}${route}`;
            const count = () => page.$eval('[aria-label="Selected document count"]', element => element.textContent);
            const select = async files => {
                await page.$eval('input[type="file"]', (input, files) => {
                    const transfer = new DataTransfer();
                    for (const file of files) transfer.items.add(new File([file.large ? new Uint8Array(1024 * 1024 + 1) : "%PDF-1.7 " + file.name], file.name, { type: file.type || "application/pdf" }));
                    input.files = transfer.files; input.dispatchEvent(new Event("change", { bubbles: true }));
                }, files);
            };
            const names = Array.from({ length: 7 }, (_, index) => ({ name: `Proof ${index}.pdf` }));
            const complete = async () => {
                await page.type('input[name="name"]', "Fixture Alumni");
                await page.type('input[name="email"]', "fixture@gmail.com");
                await page.select('select[name="course"]', "BSIT");
                await page.type('input[name="graduationYear"]', "2024");
                await page.type('input[name="password"]', "Fixture-password-123");
                if (route === "/active") await page.type('input[name="confirmPassword"]', "Fixture-password-123");
                await page.click(".consent-row .highlight-link");
                await page.waitForSelector(".modal-body");
                await page.waitForFunction(() => [...document.querySelectorAll("button")].some(button => button.textContent.trim() === "I Understand & Agree" && !button.disabled));
                await page.evaluate(() => [...document.querySelectorAll("button")].find(button => button.textContent.trim() === "I Understand & Agree").click());
                await page.waitForFunction(() => !document.querySelector('input[name="consent"]').disabled);
                if (!await page.$eval('input[name="consent"]', input => input.checked)) await page.click('input[name="consent"]');
            };
            try {
                await page.goto(url); await page.waitForSelector('input[type="file"]');
                assert.equal(await page.$eval('input[type="file"]', input => input.multiple && !input.required), true);
                assert.equal(await count(), "0/6");
                await select(names); await page.waitForSelector('[role="alert"]');
                assert.equal(await count(), "0/6");
                assert.match(await page.$eval('[role="alert"]', element => element.textContent), /up to six/);
                await select(names.slice(0, 3)); assert.equal(await count(), "3/6");
                await select(names.slice(3)); assert.equal(await count(), "3/6");
                await select(names.slice(3, 6)); assert.equal(await count(), "6/6");
                await select([names[6]]); assert.equal(await count(), "6/6");
                await page.click('[aria-label="Remove Proof 2.pdf"]'); assert.equal(await count(), "5/6");
                for (const file of [{ name: "bad.exe", type: "application/octet-stream" }, { name: "wrong.png", type: "application/pdf" }, { name: "large.pdf", large: true }]) {
                    await select([file]); assert.equal(await count(), "5/6");
                    assert.ok(await page.$('[role="alert"]'));
                }
                await select([names[2]]); assert.equal(await count(), "6/6");
                assert.equal(await page.$('[role="alert"]'), null);
                await complete();
                await page.$eval("form", form => form.requestSubmit());
                await page.waitForFunction(() => window.submissions.length === 1);
                const submission = await page.evaluate(() => window.submissions[0]);
                const uploaded = submission.filter(([key]) => key === "proof_document").map(([, value]) => value);
                assert.deepEqual(uploaded.map(file => file.name), [0, 1, 3, 4, 5, 2].map(index => names[index].name));
                assert.deepEqual(uploaded.map(file => file.body), uploaded.map(file => "%PDF-1.7 " + file.name));
                assert.equal(Object.fromEntries(submission).course, "BSIT");
                if (route === "/active") assert.equal(Object.fromEntries(submission).registration_authorization, "fixture-authorization");
                await page.goto(url); await page.waitForSelector('input[type="file"]');
                await select([names[0]]); await page.click('[aria-label="Remove Proof 0.pdf"]');
                assert.equal(await count(), "0/6");
                await complete(); await page.$eval("form", form => form.requestSubmit());
                await page.waitForFunction(() => window.submissions.length === 1);
                assert.equal(await page.evaluate(() => window.submissions[0].some(([key]) => key === "proof_document")), false);
                assert.deepEqual(errors, []);
            } finally { await page.close(); }
        });
    } finally {
        await browser?.close(); await new Promise(resolve => server.close(resolve));
    }
});
