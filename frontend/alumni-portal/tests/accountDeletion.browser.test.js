import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';

test('settings deletion modal confirms impact, rejects duplicate sends, preserves failed rows and existing actions in both scopes', async t => {
    const root = fileURLToPath(new URL('..', import.meta.url));
    let server, browser;
    try {
        const bundle = await build({ stdin: { resolveDir: root, loader: 'jsx', contents: `
            import React from 'react'; import {createRoot} from 'react-dom/client';
            import {MemoryRouter} from 'react-router-dom';
            import AdminSettingsPage from './src/features/settings/pages/AdminSettingsPage';
            import 'bootstrap/dist/css/bootstrap.min.css';
            const role=location.pathname.includes('employer')?'employer':'alumni';
            localStorage.setItem('user', JSON.stringify({id:1,name:'Fixture admin',role:'admin',admin_scope:role}));
            localStorage.setItem('token','fixture-token');
            window.fixtureRole=role; window.calls=[];
            window.rows=[{id:11,name:'Target account',email:'target@example.invalid',role,account_status:'verified',EmployerProfile:{organization_name:'Target organization'}},
                {id:12,name:'Unrelated account',email:'other@example.invalid',role,account_status:'verified'}];
            window.previewFails=false; window.previewBlocked=false;
            window.fixtureGet=async url=>{
                if(url.endsWith('/deletion-impact')){
                    window.calls.push({method:'preview',url});
                    if(window.previewError)throw Object.assign(new Error(window.previewError.message),window.previewError);
                    if(window.previewHtml)return '<html>Wrong deployment</html>';
                    if(window.previewFails)throw new Error('Fixture preview failure');
                    return {account:{id:11,name:'Target account',email:'target@example.invalid',role},counts:{Job:role==='employer'?3:0,Application:4,ApplicationDocument:7,Resume:role==='alumni'?2:0,ResumeVersion:2},
                        preserved:{'MembershipApplication.alumni_user_id':1,'Message.sender_id':3},confirmationToken:'fixture-preview-token',canDelete:!window.previewBlocked,blockers:window.previewBlocked?['Policy awaits approval']:[]};
                }
                if(url.includes('/admin/')&&url.endsWith('/users'))return window.rows;
                if(url==='/profile')return {id:1,name:'Fixture admin',role:'admin',admin_scope:role};
                return [];
            };
            window.fixtureDelete=(url,auth,config)=>{
                window.calls.push({method:'delete',url,auth,config});
                return new Promise((resolve,reject)=>{window.finishDelete=()=>resolve({success:true,deletedUserId:11,role,msg:'Fixture account deleted'});window.failDelete=()=>reject(new Error('Fixture rollback: account preserved'));});
            };
            window.fixturePut=async(url,payload)=>{window.calls.push({method:'put',url,payload});return {user:{id:12,role,account_status:payload.status}}};
            window.fixturePost=async(url,payload)=>{window.calls.push({method:'post',url,payload});return {}};
            createRoot(document.getElementById('root')).render(<MemoryRouter><AdminSettingsPage role={role}/></MemoryRouter>);
        ` }, bundle: true, write: false, outfile: 'fixture.js', format: 'iife', platform: 'browser', jsx: 'automatic',
        define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"test"' },
        plugins: [{ name: 'fixture-api', setup(builder) {
            builder.onResolve({ filter: /\/services\/api$/ }, () => ({ path: 'api', namespace: 'fixture' }));
            builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `export const API_BASE_URL='http://127.0.0.1/api'; export const resolveFileUrl=v=>v;
                export const api={get:(...v)=>window.fixtureGet(...v),delete:(...v)=>window.fixtureDelete(...v),put:(...v)=>window.fixturePut(...v),post:(...v)=>window.fixturePost(...v)};` }));
        } }], logLevel: 'silent' });
        const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
        const css = bundle.outputFiles.find(file => file.path.endsWith('.css'))?.text || '';
        server = createServer((req, res) => {
            if (req.url === '/fixture.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(js); }
            if (req.url === '/fixture.css') { res.setHeader('Content-Type', 'text/css'); return res.end(css); }
            res.setHeader('Content-Type', 'text/html'); res.end('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
        }).listen(0, '127.0.0.1');
        await new Promise(resolve => server.once('listening', resolve));
        browser = await puppeteer.launch({ headless: true, executablePath: process.env.PUPPETEER_EXECUTABLE_PATH });
        for (const role of ['employer', 'alumni']) await t.test(role, async () => {
            const page = await browser.newPage();
            const errors = []; page.on('pageerror', error => errors.push(error.message));
            await page.setViewport({ width: role === 'alumni' ? 390 : 1280, height: 900 });
            await page.goto(`http://127.0.0.1:${server.address().port}/admin/${role}/settings`);
            await page.waitForFunction(() => document.querySelectorAll('.queue-row:not(.header)').length === 2);
            const clickText = async (selector, label) => {
                const found = await page.evaluate((sel, text) => { const node = [...document.querySelectorAll(sel)].find(button => button.textContent.trim() === text); node?.click(); return Boolean(node); }, selector, label);
                assert.ok(found, `Button found: ${label}`);
            };
            const open = async () => { await page.$eval('.action-menu', node => { node.open = true; }); await clickText('.menu-btn', 'Delete Account'); await page.waitForSelector('#account-delete-confirmation'); await page.waitForFunction(() => !document.querySelector('#account-delete-confirmation').disabled); };
            const finalDisabled = () => page.$eval('.modal-footer .btn-danger', node => node.disabled);
            await page.evaluate(() => { window.previewBlocked = true; });
            await page.$eval('.action-menu', node => { node.open = true; }); await clickText('.menu-btn', 'Delete Account');
            await page.waitForFunction(() => document.querySelector('.modal-body')?.textContent.includes('Policy awaits approval'));
            assert.equal(await finalDisabled(), true);
            assert.equal(await page.$eval('#account-delete-confirmation', node => node.disabled), true);
            await clickText('.modal-footer button', 'Cancel'); await page.waitForFunction(() => !document.querySelector('.modal'));
            await page.evaluate(() => { window.previewBlocked = false; window.previewFails = true; });
            await page.$eval('.action-menu', node => { node.open = true; }); await clickText('.menu-btn', 'Delete Account');
            await page.waitForFunction(() => document.querySelector('.modal-body')?.textContent.includes('Fixture preview failure'));
            assert.equal(await finalDisabled(), true);
            assert.equal(await page.evaluate(() => window.calls.filter(call => call.method === 'delete').length), 0);
            await clickText('.modal-footer button', 'Cancel'); await page.waitForFunction(() => !document.querySelector('.modal'));
            await page.evaluate(() => { window.previewFails = false; });
            for(const scenario of [{status:404,contentType:'text/html',message:'Fixture HTML route miss',expected:'deletion API endpoint was not found'}, {status:404,message:'Account not found or already deleted.',expected:'Account not found'}, {status:503,message:'Cleanup schema is not ready.',expected:'Cleanup schema'}, {status:403,message:'Admin scope access denied.',expected:'scope access denied'}]){
                await page.evaluate(error => { window.previewError=error; },scenario);
                await page.$eval('.action-menu',node=>{node.open=true;});await clickText('.menu-btn','Delete Account');
                await page.waitForFunction(text=>document.querySelector('.modal-body')?.textContent.includes(text),{},scenario.expected);
                assert.equal(await finalDisabled(),true);await clickText('.modal-footer button','Cancel');await page.waitForFunction(()=>!document.querySelector('.modal'));
            }
            await page.evaluate(()=>{window.previewError=null;window.previewHtml=true;});
            await page.$eval('.action-menu',node=>{node.open=true;});await clickText('.menu-btn','Delete Account');
            await page.waitForFunction(()=>document.querySelector('.modal-body')?.textContent.includes('non-JSON response'));
            assert.equal(await finalDisabled(),true);await clickText('.modal-footer button','Cancel');await page.waitForFunction(()=>!document.querySelector('.modal'));
            await page.evaluate(()=>{window.previewHtml=false;});
            await open();
            await page.screenshot({ path: fileURLToPath(new URL(`../../../tmp/account-deletion-${role}.png`, import.meta.url)) });
            assert.equal(await finalDisabled(), true);
            assert.match(await page.$eval('.modal-body', node => node.textContent), /Applications4/);
            assert.match(await page.$eval('.modal-body', node => node.textContent), /Application documents7/);
            assert.match(await page.$eval('.modal-body', node => node.textContent), /Preserved membership forms/);
            assert.doesNotMatch(await page.$eval('.modal-body', node => node.textContent), /Associated job postings, applications|All membership forms, Registrar master records|Submitted applications, saved resumes/);
            await page.type('#account-delete-confirmation', 'delete'); assert.equal(await finalDisabled(), true);
            await page.$eval('#account-delete-confirmation', node => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(node, ''); node.dispatchEvent(new Event('input', { bubbles: true })); });
            await page.type('#account-delete-confirmation', 'DELETE'); assert.equal(await finalDisabled(), false);
            await page.$eval('.modal-footer .btn-danger', node => { node.click(); node.click(); });
            await page.waitForFunction(() => window.calls.filter(call => call.method === 'delete').length === 1);
            assert.equal(await page.$$eval('.queue-row:not(.header)', nodes => nodes.length), 2);
            assert.equal(await page.$eval('.modal-footer .secondary-btn', node => node.disabled), true);
            await page.evaluate(() => window.failDelete());
            await page.waitForFunction(() => document.querySelector('.modal-body').textContent.includes('Fixture rollback'));
            assert.equal(await finalDisabled(), true); assert.equal(await page.$$eval('.queue-row:not(.header)', nodes => nodes.length), 2);
            await clickText('.modal-body button', 'Refresh impact preview'); await page.waitForFunction(() => !document.querySelector('#account-delete-confirmation').disabled);
            await page.type('#account-delete-confirmation', 'DELETE'); await clickText('.modal-footer button', 'Permanently Delete Account');
            await page.waitForFunction(() => window.calls.filter(call => call.method === 'delete').length === 2);
            const request = await page.evaluate(() => window.calls.find(call => call.method === 'delete'));
            assert.equal(request.url, `/admin/${role}/users/11`); assert.equal(request.auth, true);
            assert.deepEqual(request.config.data, { confirmation: 'DELETE', confirmationToken: 'fixture-preview-token' });
            await page.evaluate(() => window.finishDelete()); await page.waitForFunction(() => !document.querySelector('.modal'));
            assert.equal(await page.$$eval('.queue-row:not(.header)', nodes => nodes.length), 1);
            assert.match(await page.$eval('.queue-table', node => node.textContent), /Unrelated account/);
            // Existing actions still use their original endpoints and confirmations.
            await page.$eval('.action-menu', node => { node.open = true; }); await clickText('.menu-btn', 'Deactivate');
            await page.waitForSelector('.modal'); await clickText('.modal-footer button', 'Deactivate'); await page.waitForFunction(() => !document.querySelector('.modal'));
            assert.equal(await page.evaluate(() => window.calls.find(call => call.method === 'put').payload.action), 'deactivate');
            await page.$eval('.action-menu', node => { node.open = true; }); await clickText('.menu-btn', 'Reactivate');
            await page.waitForSelector('.modal'); await clickText('.modal-footer button', 'Reactivate'); await page.waitForFunction(() => !document.querySelector('.modal'));
            await page.$eval('.action-menu', node => { node.open = true; }); await clickText('.menu-btn', 'Reset Password');
            await page.waitForSelector('.modal'); await clickText('.modal-footer button', 'Send Reset Link'); await page.waitForFunction(() => !document.querySelector('.modal'));
            assert.equal(await page.evaluate(() => window.calls.find(call => call.method === 'post').url), '/auth/forgot-password');
            assert.deepEqual(errors, []);
            await page.close();
        });
    } finally { if (browser) await browser.close(); if (server) await new Promise(resolve => server.close(resolve)); }
});
