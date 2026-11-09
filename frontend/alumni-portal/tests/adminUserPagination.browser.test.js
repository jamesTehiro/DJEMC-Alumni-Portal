import test from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import puppeteer from "puppeteer";

let server, browser, base;
test.before(async () => {
    const bundle = await build({ stdin: { resolveDir: fileURLToPath(new URL("..", import.meta.url)), loader: "jsx", contents: `
        import React from 'react'; import {createRoot} from 'react-dom/client';
        import {MemoryRouter, Routes, Route} from 'react-router-dom';
        import AdminSettingsPage from './src/features/settings/pages/AdminSettingsPage';
        import AdminAlumniLayout from './src/components/layout/AdminAlumniLayout';
        import 'bootstrap/dist/css/bootstrap.min.css'; import './src/styles/index.css'; import './src/styles/portal-responsive.css';
        const role=location.pathname.includes('employer')?'employer':'alumni';
        const count=Number(new URLSearchParams(location.search).get('count') || 0);
        localStorage.setItem('user',JSON.stringify({id:999,name:'Fixture administrator',role:'admin',admin_scope:role}));
        localStorage.setItem('token','fixture-token'); window.calls=[];
        window.rows=Array.from({length:count},(_,index)=>({id:index+1,role,name:'Person '+String(index+1).padStart(2,'0'),
            email:'member'+String(index+1).padStart(2,'0')+'@example.invalid',account_status:'verified',
            EmployerProfile:{organization_name:'Company '+String(index+1).padStart(2,'0')}}));
        window.fixtureGet=async(url,auth)=>{
            window.calls.push({method:'get',url,auth});
            if(url.endsWith('/users'))return window.rows;
            if(url==='/profile')return {id:999,name:'Fixture administrator',role:'admin',admin_scope:role};
            if(url.endsWith('/deletion-impact'))return {account:window.rows.find(row=>row.id===Number(url.split('/').at(-2))),counts:{Application:0},preserved:{},canDelete:true,blockers:[],confirmationToken:'fixture-proof'};
            return [];
        };
        window.fixturePost=async(url,payload,auth)=>{window.calls.push({method:'post',url,payload,auth});return {}};
        window.fixturePut=async(url,payload,auth)=>{window.calls.push({method:'put',url,payload,auth});return {user:{id:Number(url.split('/').at(-2)),role,account_status:payload.status}}};
        window.fixtureDelete=async(url,auth,config)=>{const id=Number(url.split('/').at(-1));window.calls.push({method:'delete',url,auth,config});return {success:true,deletedUserId:id,role,msg:'Fixture account deleted'}};
        createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={[location.pathname]}><Routes>
            <Route element={<AdminAlumniLayout/>}><Route path='/admin/alumni/settings' element={<AdminSettingsPage role='alumni'/>}/></Route>
            <Route path='/admin/employer/settings' element={<AdminSettingsPage role='employer'/>}/>
        </Routes></MemoryRouter>);
    ` }, bundle: true, write: false, outfile: "fixture.js", format: "iife", platform: "browser", jsx: "automatic",
        define: { "import.meta.env": "{}", "process.env.NODE_ENV": '"test"' },
        plugins: [{ name: "fixture-api", setup(builder) {
            builder.onResolve({ filter: /\/services\/api$/ }, () => ({ path: "api", namespace: "fixture" }));
            builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: `export const API_BASE_URL='http://fixture/api'; export const resolveFileUrl=v=>v;
                export const api={get:(...v)=>window.fixtureGet(...v),post:(...v)=>window.fixturePost(...v),put:(...v)=>window.fixturePut(...v),delete:(...v)=>window.fixtureDelete(...v)};` }));
        } }], logLevel: "silent" });
    const js = bundle.outputFiles.find(file => file.path.endsWith(".js")).text;
    const css = bundle.outputFiles.find(file => file.path.endsWith(".css")).text;
    server = createServer((req, res) => {
        if (req.url === "/fixture.js") { res.setHeader("Content-Type", "text/javascript"); return res.end(js); }
        if (req.url === "/fixture.css") { res.setHeader("Content-Type", "text/css"); return res.end(css); }
        res.setHeader("Content-Type", "text/html");
        res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script>');
    }).listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    base = `http://127.0.0.1:${server.address().port}`;
    browser = await puppeteer.launch({ executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, pipe: true });
});
test.after(async () => {
    await browser?.close();
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

const rowSelector = ".admin-user-management-rows > .queue-row:has(.actions)";
const navSelector = 'nav[aria-label="User management pagination"]';
async function fixture(role, count, width = 1440) {
    const page = await browser.newPage();
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.setViewport({ width, height: 1000 });
    await page.setRequestInterception(true);
    page.on("request", request => new URL(request.url()).origin === base ? request.continue() : request.abort());
    await page.goto(`${base}/admin/${role}/settings?count=${count}`);
    await page.waitForSelector(".admin-user-page-count");
    return { page, errors };
}
const range = page => page.$eval(".admin-user-page-count", node => node.textContent.trim());
async function pageButton(page, label) {
    const found = await page.evaluate((selector, text) => {
        const button = [...document.querySelectorAll(selector + " button")].find(node => node.textContent.trim() === text && !node.disabled);
        button?.click(); return !!button;
    }, navSelector, label);
    assert.equal(found, true, `Enabled pagination button: ${label}`);
}
async function search(page, value) {
    await page.focus('input[aria-label="Search users by name or email"]');
    await page.keyboard.down("Control"); await page.keyboard.press("KeyA"); await page.keyboard.up("Control");
    await page.keyboard.press("Backspace");
    if (value) await page.type('input[aria-label="Search users by name or email"]', value);
}
const clickAction = (page, label) => page.evaluate(text => [...document.querySelectorAll(".action-menu[open] button")].find(button => button.textContent.trim() === text)?.click(), label);
const menuContained = page => page.evaluate(() => {
    const body = document.querySelector(".admin-user-management-rows").getBoundingClientRect();
    const menu = document.querySelector(".action-menu[open]").getBoundingClientRect();
    return menu.top >= body.top - 1 && menu.bottom <= body.bottom + 1;
});

for (const role of ["alumni", "employer"]) {
    test(`${role}: pagination, full-list search, query reset, existing actions and Send Warning`, async () => {
        const { page, errors } = await fixture(role, 25);
        try {
            assert.equal(await page.$$eval(rowSelector, rows => rows.length), 10);
            assert.equal(await range(page), "Showing 1–10 of 25 users");
            assert.equal(await page.$eval(navSelector + " button:first-child", node => node.disabled), true);
            assert.equal(await page.$eval('[aria-current="page"][aria-label="Page 1"]', node => getComputedStyle(node).backgroundColor), "rgb(0, 103, 75)");
            assert.equal(await page.$(".admin-user-search-field > svg"), null);
            for (let index = 0; index < 10; index++) {
                await page.$$eval(rowSelector, (rows, i) => { rows[i].querySelector("details").open = true; }, index);
                assert.equal(await menuContained(page), true, `Action menu on row ${index + 1} is visible`);
                await page.$$eval(rowSelector, (rows, i) => { rows[i].querySelector("details").open = false; }, index);
            }
            const height = await page.$eval(".admin-user-management-rows", node => node.getBoundingClientRect().height);
            await pageButton(page, "Next"); assert.equal(await range(page), "Showing 11–20 of 25 users");
            assert.match(await page.$eval(rowSelector, node => node.textContent), /member11@/);
            await pageButton(page, "Previous"); assert.equal(await range(page), "Showing 1–10 of 25 users");
            await pageButton(page, "3"); assert.equal(await range(page), "Showing 21–25 of 25 users");
            assert.equal(await page.$$eval(rowSelector, rows => rows.length), 5);
            assert.equal(await page.$eval(navSelector + " button:last-child", node => node.disabled), true);
            assert.equal(await page.$eval(".admin-user-management-rows", node => node.getBoundingClientRect().height), height);
            await search(page, "MEMBER25@"); assert.equal(await range(page), "Showing 1–1 of 1 users");
            assert.match(await page.$eval(rowSelector, node => node.textContent), /member25@/);
            assert.equal(await page.$(navSelector), null);
            assert.equal(await page.$$eval('select[name="userId"] option', nodes => nodes.length), 26);
            await search(page, "person 25"); assert.equal(await range(page), "Showing 1–1 of 1 users");
            if (role === "employer") { await search(page, "company 25"); assert.equal(await range(page), "Showing 1–1 of 1 users"); }
            await search(page, "member"); await pageButton(page, "2");
            await search(page, "MEMBER"); assert.equal(await range(page), "Showing 1–10 of 25 users");
            await pageButton(page, "2"); await page.click('button[aria-label="Clear user search"]');
            assert.equal(await range(page), "Showing 1–10 of 25 users");
            assert.equal(await page.$eval('input[type="search"]', node => node.placeholder), "Search users by name or email...");
            // The tenth row's dropdown remains reachable inside the bounded list.
            await page.click(`${rowSelector}:last-child summary`);
            assert.equal(await menuContained(page), true);
            await clickAction(page, "Reset Password"); await page.waitForSelector(".modal");
            assert.match(await page.$eval(".modal-body", node => node.textContent), /member10@/);
            await page.$eval(".modal-footer .secondary-btn", node => node.click());
            await page.waitForFunction(() => !document.querySelector(".modal"));
            await pageButton(page, "2");
            await page.click(`${rowSelector}:first-child summary`); await clickAction(page, "Deactivate");
            await page.waitForSelector(".modal"); await page.$eval(".modal-footer .primary-btn", node => node.click());
            await page.waitForFunction(() => !document.querySelector(".modal"));
            assert.match(await page.$eval(rowSelector, node => node.textContent), /deactivated/);
            assert.equal(await range(page), "Showing 11–20 of 25 users");
            await page.select('select[name="userId"]', "25"); await page.type('textarea[name="message"]', "Fixture reminder");
            await page.$eval(".audit-panel form", node => node.requestSubmit());
            await page.waitForFunction(() => document.body.textContent.includes("Warning sent."));
            const calls = await page.evaluate(() => window.calls);
            assert.ok(calls.some(call => call.method === "put" && call.url === `/admin/${role}/users/11/status` && call.payload.action === "deactivate" && call.auth));
            assert.ok(calls.some(call => call.method === "post" && call.payload.userId === "25" && call.payload.message === "Fixture reminder" && call.auth));
            assert.equal(calls.filter(call => call.method === "get" && call.url.endsWith("/users")).length, 1, "Pagination and search do not alter or refetch the existing API");
            assert.deepEqual(errors, []);
        } finally { await page.close(); }
    });

    test(`${role}: zero, fewer than ten, exactly ten, eleven users and last-page deletion`, async () => {
        for (const count of [0, 7, 10, 11]) {
            const { page, errors } = await fixture(role, count);
            try {
                assert.equal(await page.$$eval(rowSelector, nodes => nodes.length), Math.min(10, count));
                assert.equal(await range(page), `Showing ${count ? 1 : 0}–${Math.min(10, count)} of ${count} users`);
                assert.equal(!!await page.$(navSelector), count > 10);
                if (!count) assert.match(await page.$eval(".admin-user-management-rows", node => node.textContent), /No users found/);
                if (count === 11) {
                    await pageButton(page, "2"); assert.equal(await range(page), "Showing 11–11 of 11 users");
                    await page.click(`${rowSelector} summary`);
                    assert.equal(await menuContained(page), true, "Single-row last page keeps its action menu visible");
                    await page.click(".action-menu[open] .menu-btn:last-child");
                    await page.waitForFunction(() => document.querySelector("#account-delete-confirmation")?.disabled === false);
                    await page.type("#account-delete-confirmation", "DELETE");
                    await page.$eval(".modal-footer .btn-danger", node => node.click());
                    await page.waitForFunction(() => !document.querySelector(".modal"));
                    assert.equal(await range(page), "Showing 1–10 of 10 users");
                    assert.equal(await page.$$eval(rowSelector, nodes => nodes.length), 10);
                    assert.equal(await page.$(navSelector), null);
                }
                await search(page, "no-matching-account");
                assert.equal(await range(page), "Showing 0–0 of 0 users");
                assert.equal(await page.$(navSelector), null);
                assert.deepEqual(errors, []);
            } finally { await page.close(); }
        }
    });

    test(`${role}: desktop, tablet and mobile pagination stays inside its section`, async () => {
        const { page, errors } = await fixture(role, 105);
        try {
            for (const width of [1440, 900, 390]) {
                await page.setViewport({ width, height: 1000 });
                const layout = await page.evaluate(() => {
                    const card = document.querySelector(".admin-user-management").getBoundingClientRect();
                    const footer = document.querySelector(".admin-user-pagination").getBoundingClientRect();
                    const warning = document.querySelector(".audit-panel").getBoundingClientRect();
                    return { noPageOverflow: document.documentElement.scrollWidth <= innerWidth + 1,
                        footerContained: footer.left >= card.left && footer.right <= card.right + 1 && footer.bottom <= card.bottom,
                        warningSeparate: warning.left >= card.right - 1 || warning.top >= card.bottom - 1,
                        buttonsContained: [...document.querySelectorAll('.admin-user-pagination button')].every(button => { const r = button.getBoundingClientRect(); return r.left >= card.left && r.right <= card.right + 1; }) };
                });
                assert.deepEqual(layout, { noPageOverflow: true, footerContained: true, warningSeparate: true, buttonsContained: true }, `Layout at ${width}px`);
                assert.equal(await page.$$eval(rowSelector, rows => rows.length), 10);
                await page.screenshot({ path: fileURLToPath(new URL(`../../../tmp/user-management-${role}-${width}.png`, import.meta.url)), fullPage: true });
                if (width === 390) {
                    const scroll = () => page.$eval(".admin-user-management-rows", node => { node.scrollTop = node.scrollHeight; return node.scrollTop; });
                    assert.ok(await scroll() > 0);
                    await pageButton(page, "Next");
                    assert.equal(await range(page), "Showing 11–20 of 105 users");
                    assert.equal(await page.$eval(".admin-user-management-rows", node => node.scrollTop), 0);
                    await scroll(); await search(page, "member");
                    assert.equal(await range(page), "Showing 1–10 of 105 users");
                    assert.equal(await page.$eval(".admin-user-management-rows", node => node.scrollTop), 0);
                }
            }
            assert.deepEqual(errors, []);
        } finally { await page.close(); }
    });
}
