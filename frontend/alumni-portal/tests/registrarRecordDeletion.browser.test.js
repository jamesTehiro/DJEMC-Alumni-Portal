import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';
import process from 'node:process';

const browserExecutable = process.env.PUPPETEER_EXECUTABLE_PATH || await puppeteer.executablePath();
const browserAvailable = existsSync(browserExecutable);

test('Registrar record deletion confirms, protects linked accounts, reports failures and keeps filters/pages consistent', { skip: browserAvailable ? false : `No local browser executable found at ${browserExecutable}.` }, async t => {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const output = await build({
        stdin: { resolveDir: root, loader: 'jsx', contents: `
            import React from 'react'; import {createRoot} from 'react-dom/client';
            import {MemoryRouter} from 'react-router-dom';
            import 'bootstrap/dist/css/bootstrap.min.css'; import './src/index.css';
            import RegistrarRecordsPage from './src/pages/RegistrarRecordsPage';
            const records=Array.from({length:11},(_,index)=>({id:index+1,full_name:'Fixture Record '+String(index+1).padStart(2,'0'),course:'BSIT',major:'Software Engineering',batch_year:2020+index}));
            window.fixtureRecords=records;window.fixtureDeleteCalls=[];window.fixtureDeleteMode='success';
            window.fixtureDelete=async url=>{
                window.fixtureDeleteCalls.push(url);
                if(window.fixtureDeleteMode==='hold')return new Promise(resolve=>{window.releaseDelete=()=>resolve({success:true});});
                if(window.fixtureDeleteMode==='linked')throw Object.assign(new Error('This alumni record is linked to a registered account and cannot be deleted.'),{status:409});
                if(window.fixtureDeleteMode==='network')throw new Error('Network unavailable. Please try again.');
                return {success:true};
            };
            localStorage.setItem('user',JSON.stringify({id:501,name:'Disposable Registrar',role:'admin',admin_scope:'registrar'}));
            localStorage.setItem('token','fixture-only-token');
            createRoot(document.getElementById('root')).render(<MemoryRouter><RegistrarRecordsPage/></MemoryRouter>);
        ` },
        bundle: true, write: false, outdir: 'fixture', format: 'iife', platform: 'browser', jsx: 'automatic',
        define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"test"' },
        plugins: [{ name: 'registrar-delete-fixtures', setup(builder) {
            builder.onResolve({ filter: /\/services\/api$/ }, () => ({ path: 'api', namespace: 'fixture' }));
            builder.onLoad({ filter: /^api$/, namespace: 'fixture' }, () => ({ contents: 'export const api={get:async()=>[],delete:(url)=>window.fixtureDelete(url)};' }));
            builder.onResolve({ filter: /\/registrar\/useRegistrarAdminData$/ }, () => ({ path: 'registrar-hook', namespace: 'fixture' }));
            builder.onLoad({ filter: /^registrar-hook$/, namespace: 'fixture' }, () => ({ resolveDir: root, contents: `import React,{useState} from 'react';export default function useRegistrarAdminData(){const [records,setRecords]=useState(window.fixtureRecords);const [selectedRecord,setSelectedRecord]=useState(null);return {isAllowed:true,records,setRecords,selectedRecord,setSelectedRecord,message:'',error:'',showAddModal:false,editingRecord:null,openEditModal(){},savingRecord:false,handleSaveRecord:async()=>{},openAddModal(){},closeAddModal(){}};}` }));
            builder.onResolve({ filter: /\/components\/AdminShell$/ }, () => ({ path: 'admin-shell', namespace: 'fixture' }));
            builder.onLoad({ filter: /^admin-shell$/, namespace: 'fixture' }, () => ({ loader: 'jsx', resolveDir: root, contents: `import React from 'react';export default function AdminShell({title,children}){return <main><h1>{title}</h1>{children}</main>;}` }));
            builder.onResolve({ filter: /\/components\/AddAlumniModal$/ }, () => ({ path: 'add-modal', namespace: 'fixture' }));
            builder.onResolve({ filter: /\/components\/CsvAlumniImportModal$/ }, () => ({ path: 'csv-modal', namespace: 'fixture' }));
            builder.onLoad({ filter: /^(add-modal|csv-modal)$/, namespace: 'fixture' }, () => ({ contents: 'export default function FixtureModal(){return null;}' }));
            builder.onResolve({ filter: /\/hooks\/useRenderDebug$/ }, () => ({ path: 'render-debug', namespace: 'fixture' }));
            builder.onLoad({ filter: /^render-debug$/, namespace: 'fixture' }, () => ({ contents: 'export default function useRenderDebug(){}' }));
        } }], logLevel: 'silent'
    });
    const bundle = output.outputFiles.find(file => file.path.endsWith('.js')).text;
    const css = output.outputFiles.find(file => file.path.endsWith('.css')).text.replace(/@import[^;]+;/g, '');
    const server = createServer((req, res) => {
        if (req.url === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle); }
        else if (req.url === '/styles.css') { res.setHeader('Content-Type', 'text/css'); res.end(css); }
        else res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><div id="root"></div><script src="/bundle.js"></script>');
    }).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    let browser;
    try {
        browser = await puppeteer.launch({ headless: true, pipe: true, executablePath: browserExecutable });
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        const base = `http://127.0.0.1:${server.address().port}`;
        await page.setRequestInterception(true);
        page.on('request', request => request.url().startsWith(base + '/') ? request.continue() : request.abort());
        await page.setViewport({ width: 1280, height: 900 });
        await page.goto(base);
        await page.waitForSelector('.master-records-table-scroll tbody tr');
        const rowCount = () => page.$$eval('.master-records-table-scroll tbody tr', rows => rows.filter(row => !row.querySelector('.master-records-empty')).length);
        const deleteButton = name => page.click(`button[aria-label="Delete ${name}"]`);

        await t.test('confirmation identifies the record and Cancel leaves it untouched', async () => {
            await deleteButton('Fixture Record 01');
            await page.waitForSelector('.modal.show');
            assert.match(await page.$eval('.modal.show', modal => modal.textContent), /Delete Alumni Record/);
            assert.match(await page.$eval('.modal.show', modal => modal.textContent), /Fixture Record 01/);
            await page.click('.modal.show .btn-secondary');
            await page.waitForSelector('.modal.show', { hidden: true });
            assert.equal(await page.evaluate(() => window.fixtureDeleteCalls.length), 0);
            assert.equal(await rowCount(), 10);
        });

        await t.test('search-filtered record stays visible after a linked-account refusal and an API failure', async () => {
            const search = page.locator('input[aria-label="Search alumni records"]');
            await search.fill('Fixture Record 03');
            assert.equal(await rowCount(), 1);
            await page.evaluate(() => { window.fixtureDeleteMode = 'linked'; });
            await deleteButton('Fixture Record 03');
            await page.click('.modal.show .btn-danger');
            await page.waitForFunction(() => document.body.innerText.includes('linked to a registered account'));
            assert.equal(await rowCount(), 1);
            assert.ok(await page.$('.modal.show'));
            assert.equal(await page.evaluate(() => window.fixtureDeleteCalls.length), 1);
            await page.click('.modal.show .btn-secondary');
            await page.waitForSelector('.modal.show', { hidden: true });

            await page.evaluate(() => { window.fixtureDeleteMode = 'network'; });
            await deleteButton('Fixture Record 03');
            await page.click('.modal.show .btn-danger');
            await page.waitForFunction(() => document.body.innerText.includes('Network unavailable'));
            assert.equal(await rowCount(), 1);
            assert.equal(await page.evaluate(() => window.fixtureDeleteCalls.length), 2);
            await page.click('.modal.show .btn-secondary');
            await page.waitForSelector('.modal.show', { hidden: true });
            await search.fill('');
            assert.equal(await rowCount(), 10);
        });

        await t.test('success prevents duplicate confirmation and deletion on page two returns to a valid page', async () => {
            const search = page.locator('input[aria-label="Search alumni records"]');
            await search.fill('');
            await page.select('select[aria-label="Rows per page"]', '10');
            await page.click('button[aria-label="Next page"]');
            assert.equal(await rowCount(), 1);
            assert.match(await page.$eval('.master-records-table tbody', body => body.textContent), /Fixture Record 11/);

            await deleteButton('Fixture Record 11');
            await page.evaluate(() => { window.fixtureDeleteMode = 'hold'; });
            await page.click('.modal.show .btn-danger');
            await page.waitForFunction(() => document.querySelector('.modal.show .btn-danger')?.disabled === true);
            await page.$eval('.modal.show .btn-danger', button => button.click());
            assert.equal(await page.evaluate(() => window.fixtureDeleteCalls.length), 3);
            await page.evaluate(() => window.releaseDelete());
            await page.waitForFunction(() => !document.querySelector('.modal.show') && document.querySelector('.master-records-card header span')?.textContent.includes('10 of 10'));
            assert.equal(await rowCount(), 10);
            assert.equal(await page.$eval('button[aria-label="Next page"]', button => button.disabled), true);
            assert.match(await page.$eval('.toast-body', body => body.textContent), /Fixture Record 11 was deleted/);
            assert.deepEqual(errors, []);
        });
    } finally {
        if (browser) await browser.close();
        server.closeAllConnections?.();
        await new Promise(resolve => server.close(resolve));
    }
});
