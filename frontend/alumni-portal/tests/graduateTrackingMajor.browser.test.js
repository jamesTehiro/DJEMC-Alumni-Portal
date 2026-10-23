import test from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import puppeteer from "puppeteer";

test("Graduate Tracking major search preserves filters, pagination and existing search fields", async t => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const output = await build({ stdin: { resolveDir: root, loader: "jsx", contents: `
        import React from 'react'; import {createRoot} from 'react-dom/client'; import {MemoryRouter} from 'react-router-dom';
        import AdminUsersPage from './src/pages/admin/AdminUsersPage';
        const make=(id,course,major,year=2024)=>({id,name:'Graduate '+String(id).padStart(2,'0'),role:'alumni',account_status:'verified',AlumniRecord:{full_name:'Graduate '+String(id).padStart(2,'0'),course,major,batch_year:year},AlumniProfile:{course,major:'Accounting Education',graduation_year:year,employment_status:'employed',job_title:'Teacher',current_company:'Fixture School'}});
        const records=Array.from({length:12},(_,index)=>make(index+1,'BSED','Computer Education',index<6?2024:2023));
        const same=make(13,'BSED',null);same.AlumniProfile.major=' Computer Education ';
        const alias=make(14,'Bachelor of Secondary Education','   ',2023);alias.AlumniProfile.course='BSED';alias.AlumniProfile.major='Computer Education';
        const profileOnly=make(15,'BSBA','Accounting',2022);profileOnly.AlumniRecord=null;profileOnly.name='Profile Graduate';profileOnly.AlumniProfile.major='Accounting';
        const missing=make(16,'BSED',null);missing.AlumniProfile=null;
        const different=make(17,'BSIT',null);different.AlumniProfile.course='BSBA';different.AlumniProfile.major='Accounting';
        const official=make(18,'BSBA','Financial Management');official.AlumniProfile.major='Accounting';official.AlumniProfile.job_title='Research Fellow';
        const absent=make(19,'BSIT',undefined);delete absent.AlumniProfile.major;
        const accounting=make(20,'BSBA','Accounting');accounting.AlumniProfile.current_company='Orbit Labs';
        const fallback=make(21,'BSBA','');fallback.AlumniProfile.major='Accounting';
        records.push(same,alias,profileOnly,missing,different,official,absent,accounting,fallback);
        window.calls=[];window.fixtureGet=async(url,auth)=>{if(!auth)throw Error('Missing authentication');window.calls.push(url);if(url==='/admin/alumni/users')return [...records].reverse();if(url==='/admin/alumni/tracking-summary')return {totalGraduates:30,employed:20,unemployed:7,selfEmployed:3};throw Error('Unexpected request: '+url);};
        localStorage.setItem('user',JSON.stringify({id:101,role:'admin',admin_scope:new URL(location.href).searchParams.get('scope')||'alumni'}));localStorage.setItem('token','fixture-token');
        createRoot(document.getElementById('root')).render(<MemoryRouter><AdminUsersPage role="alumni"/></MemoryRouter>);
    ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "import.meta.env": "{}", "process.env.NODE_ENV": '"test"' }, plugins: [{ name: "fixtures", setup(builder) {
        builder.onResolve({ filter: /\.css$/ }, () => ({ path: "css", namespace: "fixture" }));
        builder.onLoad({ filter: /^css$/, namespace: "fixture" }, () => ({ contents: "export default {};" }));
        builder.onResolve({ filter: /\/services\/api$/ }, () => ({ path: "api", namespace: "fixture" }));
        builder.onLoad({ filter: /^api$/, namespace: "fixture" }, () => ({ contents: "export const API_BASE_URL='http://fixture.invalid/api';export const resolveFileUrl=value=>value||'';export const api={get:(...args)=>window.fixtureGet(...args),post:()=>{throw Error('Unexpected write');}};" }));
    } }], logLevel: "silent" });
    const server = createServer((req, res) => {
        if (req.url === "/fixture.js") { res.setHeader("Content-Type", "text/javascript"); res.end(output.outputFiles[0].text); }
        else res.end('<!doctype html><div id="root"></div><script src="/fixture.js"></script>');
    }).listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    let browser;
    try {
        browser = await puppeteer.launch({ headless: true, pipe: true, executablePath: process.env.PUPPETEER_EXECUTABLE_PATH });
        const page = await browser.newPage();
        const errors = []; page.on("pageerror", error => errors.push(error.message));
        const base = `http://127.0.0.1:${server.address().port}`;
        await page.setRequestInterception(true);
        page.on("request", request => request.url().startsWith(base + "/") ? request.continue() : request.abort());
        await page.goto(base); await page.waitForFunction(() => document.querySelector('.alumni-tracking-heading > strong')?.textContent === '21 matching alumni');
        const settle = () => page.evaluate(() => new Promise(requestAnimationFrame));
        const search = async value => {
            await page.$eval('input[aria-label="Search alumni records"]', (input, value) => {
                Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
                input.dispatchEvent(new Event("input", { bubbles: true }));
            }, value);
            await settle();
        };
        const select = async (label, value) => { await page.select(`select[aria-label="${label}"]`, value); await settle(); };
        const count = () => page.$eval(".alumni-tracking-heading > strong", element => Number.parseInt(element.textContent));
        const names = () => page.$$eval(".alumni-tracking-table tbody strong", elements => elements.map(element => element.textContent));
        const pagination = () => page.$eval(".alumni-tracking-pagination > span", element => element.textContent);
        const next = async () => { await page.$$eval(".alumni-tracking-pagination button", buttons => buttons.find(button => button.textContent === "Next").click()); await settle(); };
        const reset = async () => { await search(""); await select("Filter by course", ""); await select("Filter by academic year", ""); };

        await t.test("exact, partial, case-insensitive and trimmed major queries include same-program profile fallbacks", async () => {
            for (const query of ["Computer Education", "computer", "cOmPuTeR", "  COMPUTER EDUCATION  "]) {
                await search(query);
                assert.equal(await count(), 14, query);
            }
            await search("Graduate 13");
            assert.equal(await page.$eval(".alumni-tracking-table tbody tr td:nth-child(4)", cell => cell.textContent), "Computer Education");
            await search("Graduate 14");
            assert.equal(await page.$eval(".alumni-tracking-table tbody tr td:nth-child(4)", cell => cell.textContent), "Computer Education");
        });
        await t.test("official majors win, different programs never mix, and absent majors remain safe", async () => {
            await reset(); await search("accounting");
            assert.equal(await count(), 3);
            assert.deepEqual(await names(), ["Graduate 20", "Graduate 21", "Profile Graduate"]);
            for (const query of ["Graduate 16", "Graduate 17", "Graduate 19"]) {
                await search(query); assert.equal(await count(), 1);
                assert.equal(await page.$eval(".alumni-tracking-table tbody tr td:nth-child(4)", cell => cell.textContent), "Not recorded");
            }
            await search("Graduate 18");
            assert.equal(await page.$eval(".alumni-tracking-table tbody tr td:nth-child(4)", cell => cell.textContent), "Financial Management");
        });
        await t.test("program/year filters compose with major search and summary cards remain unchanged", async () => {
            await reset(); await search("computer"); await select("Filter by course", "BSED");
            assert.equal(await count(), 14);
            await select("Filter by academic year", "2024"); assert.equal(await count(), 7);
            await select("Filter by academic year", "2023"); assert.equal(await count(), 7);
            await select("Filter by course", "BSBA"); assert.equal(await count(), 0);
            assert.equal(await page.$eval(".alumni-tracking-empty", cell => cell.textContent), "No alumni match these filters.");
            assert.equal(await pagination(), "Page 1 of 1");
            await search(""); await select("Filter by course", "BSED"); assert.equal(await count(), 7);
            await select("Filter by course", ""); await select("Filter by academic year", "2022"); assert.equal(await count(), 1);
            assert.deepEqual(await names(), ["Profile Graduate"]);
            await select("Filter by academic year", ""); await select("Filter by course", "BSIT"); assert.equal(await count(), 2);
            assert.deepEqual(await page.$$eval(".alumni-tracking-summary strong", elements => elements.map(element => element.textContent)), ["30", "20", "7", "3"]);
        });
        await t.test("search, filter and page-size changes reset pagination and the count includes all matching pages", async () => {
            await reset(); await next(); assert.equal(await pagination(), "Page 2 of 3");
            await search("computer"); assert.equal(await pagination(), "Page 1 of 2"); assert.equal(await count(), 14);
            assert.equal((await names()).length, 10);
            await next(); assert.equal(await pagination(), "Page 2 of 2"); assert.equal((await names()).length, 4);
            assert.equal(await count(), 14);
            await select("Filter by academic year", "2024"); assert.equal(await pagination(), "Page 1 of 1"); assert.equal(await count(), 7);
            await select("Filter by academic year", ""); await next();
            await page.select(".alumni-tracking-pagination select", "25"); await settle();
            assert.equal(await pagination(), "Page 1 of 1"); assert.equal((await names()).length, 14);
        });
        await t.test("name, program code/label, year, position, company and employment searches still work", async () => {
            await reset();
            for (const [query, expected] of [["Graduate 01", 1], ["BSIT", 2], ["Information Technology", 2], ["2022", 1], ["Research Fellow", 1], ["Orbit Labs", 1], ["employed", 20], ["education", 15], ["nothing matches", 0]]) {
                await search(query); assert.equal(await count(), expected, query);
            }
        });
        await t.test("role restrictions and existing search placeholder remain intact", async () => {
            assert.equal(await page.$eval('input[aria-label="Search alumni records"]', input => input.placeholder), "Search name, program, major, year, position, or company");
            await page.goto(base + "/?scope=registrar");
            await page.waitForFunction(() => document.body.textContent.includes("Alumni Admin Access Only"));
            assert.deepEqual(await page.evaluate(() => window.calls), []);
        });
        assert.deepEqual(errors, []);
    } finally {
        await browser?.close(); await new Promise(resolve => server.close(resolve));
    }
});
