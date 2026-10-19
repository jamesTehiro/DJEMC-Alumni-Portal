import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import puppeteer from "puppeteer";

test("Admin Alumni sidebar omits membership navigation and preserves its nodes on desktop and mobile", async () => {
    const result = await build({
        stdin: { resolveDir: fileURLToPath(new URL("..", import.meta.url)), loader: "jsx", contents: `
            import React, { lazy, Suspense } from 'react';
            import { createRoot } from 'react-dom/client';
            import { MemoryRouter, Routes, Route } from 'react-router-dom';
            import AdminShell from './src/components/AdminShell';
            import AdminAlumniLayout from './src/components/AdminAlumniLayout';
            window.accessCalls = 0;
            window.fixtureGet = () => { window.accessCalls++; return new Promise(resolve => { window.grantAccess = () => resolve({scope:'alumni',can_view:window.allowed}); }); };
            const user = {id:1,name:'Test Admin',role:'admin',admin_scope:window.scope};
            localStorage.setItem('user', JSON.stringify(user));
            localStorage.setItem('token', 'test-fixture-token');
            function Page({title}) { return <AdminShell scope={window.scope} title={title} subtitle={title+' content'} onLogout={()=>{window.logoutCalled=true}}><div data-page={title}>{title} content</div></AdminShell>; }
            const titles = {'':'Dashboard',users:'Alumni Records',messages:'Messages',moderation:'Post Announcement',logs:'System Logs',settings:'Profile'};
            const Delayed = lazy(() => new Promise(resolve => { window.finishLoading = () => resolve({default:()=> <Page title="Post Announcement"/>}); }));
            createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={['/admin/'+window.scope]}><Routes>
                {window.scope==='alumni' ? <Route element={<AdminAlumniLayout/>}>{Object.entries(titles).map(([path,title])=><Route key={path} path={'/admin/alumni'+(path?'/'+path:'')} element={path==='moderation'?<Delayed/>:<Page title={title}/>}/>)}</Route> : <Route path="*" element={<Page title="Dashboard"/>}/>}
            </Routes></MemoryRouter>);
        ` }, bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", loader: { ".css": "empty" },
        define: { "import.meta.env": "{}", "process.env.NODE_ENV": '"test"' },
        plugins: [{ name: "fixture-api", setup(builder) {
            builder.onResolve({ filter: /\.css$/ }, () => ({ path: "fixture-css", namespace: "fixture-css" }));
            builder.onLoad({ filter: /.*/, namespace: "fixture-css" }, () => ({ contents: 'export default {};' }));
            builder.onResolve({ filter: /\/services\/api$/ }, () => ({ path: "fixture-api", namespace: "fixture" }));
            builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: 'export const API_BASE_URL="http://fixture/api"; export const api={get:(...args)=>window.fixtureGet(...args)};' }));
        } }], logLevel: "silent"
    });
    const bundle = result.outputFiles[0].text;
    const server = createServer((req, res) => {
        if (req.url === "/bundle.js") { res.setHeader("Content-Type", "text/javascript"); res.end(bundle); }
        else res.end('<!doctype html><div id="root"></div><script src="/bundle.js"></script>');
    }).listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    let browser;
    try {
        browser = await puppeteer.launch({ headless: true, executablePath: process.env.PUPPETEER_EXECUTABLE_PATH });
        const page = await browser.newPage();
        const errors = [];
        page.on("pageerror", error => errors.push(error.message));
        page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
        const url = `http://127.0.0.1:${server.address().port}`;
        await page.evaluateOnNewDocument(() => { window.scope = "alumni"; window.allowed = true; });
        await page.goto(url);
        await page.waitForSelector("aside");
        await page.evaluate(() => {
            window.originalAside = document.querySelector("aside");
            window.membershipLinks = [...document.querySelectorAll("aside a")].filter(a => /membership application/i.test(a.textContent));
            window.removals = 0;
            new MutationObserver(records => { for (const record of records) for (const node of record.removedNodes) if (node === window.originalAside) window.removals++; }).observe(document.getElementById("root"), { childList: true, subtree: true });
        });
        assert.deepEqual(await page.evaluate(() => window.membershipLinks.map(link => link.textContent.trim())), []);
        for (const title of ["Post Announcement", "Alumni Records", "Dashboard", "Messages", "System Logs", "Profile"]) {
            await page.evaluate(title => [...document.querySelectorAll("aside a")].find(a => a.textContent.trim() === title).click(), title);
            if (title === "Post Announcement") {
                await page.waitForFunction(() => typeof window.finishLoading === "function");
                assert.equal(await page.evaluate(() => document.querySelector("aside") === window.originalAside), true);
                await page.evaluate(() => window.finishLoading());
            }
            await page.waitForFunction(title => document.querySelector("[data-page]")?.getAttribute("data-page") === title, {}, title);
            const state = await page.evaluate(() => ({ sameAside: document.querySelector("aside") === window.originalAside, removals: window.removals, calls: window.accessCalls, active: document.querySelector('aside a[aria-current="page"]')?.textContent.trim(), heading: document.querySelector("h1")?.textContent }));
            assert.deepEqual(state, { sameAside: true, removals: 0, calls: 0, active: title, heading: title });
        }
        await page.setViewport({ width: 390, height: 844 });
        for (const title of ["Post Announcement", "Alumni Records", "Dashboard", "Messages", "System Logs", "Profile"]) {
            await page.click('button[aria-label="Open navigation"]');
            await page.waitForFunction(() => document.body.style.overflow === "hidden");
            assert.equal(await page.$eval('button[aria-label="Close navigation"]', button => button.getAttribute("aria-expanded")), "true");
            await page.evaluate(title => [...document.querySelectorAll("aside a")].find(a => a.textContent.trim() === title).click(), title);
            await page.waitForFunction(title => document.querySelector("[data-page]")?.getAttribute("data-page") === title && document.body.style.overflow !== "hidden", {}, title);
            const state = await page.evaluate(() => ({ sameAside: document.querySelector("aside") === window.originalAside, removals: window.removals, calls: window.accessCalls, active: document.querySelector('aside a[aria-current="page"]')?.textContent.trim(), expanded: document.querySelector('button[aria-label="Open navigation"]')?.getAttribute("aria-expanded") }));
            assert.deepEqual(state, { sameAside: true, removals: 0, calls: 0, active: title, expanded: "false" });
        }
        await page.evaluate(() => [...document.querySelectorAll("aside button")].find(button => button.textContent.trim() === "Logout").click());
        assert.equal(await page.evaluate(() => window.logoutCalled), true);
        for (const scope of ["employer", "registrar", "alumni"]) {
            const denied = await browser.newPage();
            await denied.evaluateOnNewDocument(scope => { window.scope = scope; }, scope);
            await denied.goto(url);
            await denied.waitForSelector("aside");
            const labels = await denied.$$eval("aside a", links => links.map(a => a.textContent.trim()));
            assert.equal(labels.includes("Membership Applications"), false);
            assert.deepEqual(labels, scope === "employer" ? ["Dashboard", "Verification History", "Manage Posted Jobs", "Messages", "Post Job", "System Logs", "Profile"] : scope === "registrar" ? ["Dashboard", "Verification History", "Alumni Records", "Profile"] : ["Dashboard", "Alumni Records", "Messages", "Post Announcement", "System Logs", "Profile"]);
            await denied.close();
        }
        assert.deepEqual(errors, []);
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
});

test("all eight Alumni routes share the persistent shell in the application router", () => {
    const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
    const group = app.slice(app.indexOf("<AdminAlumniLayout />"), app.indexOf('<Route path="/login"'));
    for (const suffix of ["", "/users", "/membership-applications", "/messages", "/moderation", "/logs", "/settings", "/verification"]) assert.ok(group.includes(`path="/admin/alumni${suffix}"`));
});
