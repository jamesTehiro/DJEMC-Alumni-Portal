/* global process */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';

test('independent Employer and Admin Employer jobId=29 routes preserve application terminology, decisions and grouping', async () => {
    const bundle = await build({
        stdin: { resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'jsx', contents: `
            import React from 'react'; import {createRoot} from 'react-dom/client'; import {BrowserRouter,Routes,Route,useLocation} from 'react-router-dom';
            import 'bootstrap/dist/css/bootstrap.min.css'; import './src/styles/index.css';
            import Employer from './src/features/dashboard/employer/EmployerPage';
            import Admin from './src/features/jobs/pages/AdminEmployerApplicantsPage';
            import Alumni from './src/features/dashboard/alumni/Alumnipage';
            import {UndoDeleteProvider} from './src/contexts/UndoDeleteContext'; import './src/styles/portal-responsive.css';
            const job={id:29,employer_id:12,title:'Office Assistant',location:'Cebu',employment_type:'full-time',recruitment_status:'active',User:{name:'Fixture Company'}};
            const original=['pending','verified','not_verified'].map((status,index)=>({id:index+1,job_id:29,recruitment_cycle:1,status,alumni:{id:index+21,name:['Ari Pending','Ben Interview','Carla Declined'][index]},Job:job,createdAt:'2026-11-01T00:00:00Z',ApplicationDocuments:[]}));
            window.puts=[];
            window.get=async(url)=>{
                if(url==='/jobs'||url==='/admin/employer/jobs')return [job];
                if(url==='/profile'||url.startsWith('/profile/'))return {name:'Fixture Company',AlumniProfile:{}};
                if(url==='/applications/employer?archived=true'||url==='/notifications'||url==='/announcements'||url==='/admin/employer/users')return [];
                if(['/applications','/applications/employer','/admin/employer/applications','/applications/jobs/29/applicants'].includes(url))return structuredClone(window.apps);
                throw Error('Unexpected fixture GET '+url);
            };
            window.put=async(url,body,auth)=>{
                window.puts.push({url,body,auth});const app=window.apps.find(app=>url==='/applications/'+app.id+'/review');
                if(!app)throw Error('Unexpected decision endpoint');app.status=body.status;return {msg:'Existing decision response',application:structuredClone(app)};
            };
            window.apps=structuredClone(original);
            const role=location.pathname.startsWith('/admin/')?'admin':location.pathname==='/employer'?'employer':'alumni';
            localStorage.setItem('user',JSON.stringify(role==='admin'?{id:99,role:'admin',admin_scope:'employer'}:role==='employer'?{id:12,role:'employer'}:{id:21,role:'alumni'}));
            function CurrentRoute(){const value=useLocation();return <output hidden data-route>{value.pathname+value.search}</output>;}
            createRoot(document.getElementById('root')).render(<BrowserRouter><UndoDeleteProvider><CurrentRoute/><Routes>
                <Route path="/employer" element={<Employer/>}/>
                <Route path="/admin/employer/applicants" element={<Admin/>}/>
                <Route path="/dashboard" element={<div className="dashboard-layout"><Alumni/></div>}/>
            </Routes></UndoDeleteProvider></BrowserRouter>);
        ` }, bundle: true, write: false, outdir: 'fixture', format: 'iife', platform: 'browser', jsx: 'automatic',
        loader: { '.png': 'dataurl', '.jpg': 'dataurl', '.svg': 'dataurl' }, define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"test"' },
        plugins: [{ name: 'fixture-api', setup(builder) {
            builder.onResolve({ filter: /\/services\/api$/ }, () => ({ path: 'api', namespace: 'fixture' }));
            builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `export const API_BASE_URL='/api';export const resolveFileUrl=url=>url;export const fetchFile=()=>{throw Error('Unexpected file request');};export const api={get:(...args)=>window.get(...args),put:(...args)=>window.put(...args)};` }));
        } }], logLevel: 'silent'
    });
    const script = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
    const css = bundle.outputFiles.find(file => file.path.endsWith('.css')).text.replace(/@import\s+url\([^;]+;/g, '') + '\n*,*::before,*::after{animation:none!important;transition:none!important;}';
    const server = createServer((req, res) => {
        if (req.url === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(script); }
        else if (req.url === '/styles.css') { res.setHeader('Content-Type', 'text/css'); res.end(css); }
        else res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><div id="root"></div><script src="/bundle.js"></script>');
    }).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    let browser;
    try {
        browser = await puppeteer.launch({ headless: true, pipe: true, executablePath: process.env.PUPPETEER_EXECUTABLE_PATH });
        const page = await browser.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('dialog', dialog => dialog.accept());
        await page.setRequestInterception(true);
        page.on('request', request => /^(http:\/\/127\.0\.0\.1:|data:)/.test(request.url()) ? request.continue() : request.abort());
        const base = `http://127.0.0.1:${server.address().port}`;
        const clickText = async (selector, label) => {
            const button = await page.evaluateHandle((selector, label) => [...document.querySelectorAll(selector)].find(node => node.textContent.trim() === label), selector, label);
            assert.ok(button.asElement(), label); await button.asElement().click(); await button.dispose();
        };
        const count = title => page.evaluate(title => [...document.querySelectorAll('h3,h5')].find(node => node.textContent === title)?.parentElement.querySelector('span')?.textContent, title);
        for (const width of [1440, 320]) {
            await page.setViewport({ width, height: 1000 });
            for (const role of ['employer', 'admin']) {
                for (const decision of ['verified', 'not_verified']) {
                    const route = role === 'admin' ? '/admin/employer/applicants?jobId=29' : '/employer';
                    await page.goto(base + route);
                    assert.equal(await page.$eval('[data-route]', node => node.textContent), route);
                    if (role === 'employer') {
                        await page.waitForSelector('.emp-dash-card');
                        if (width <= 1024) {
                            await page.click('button[aria-label="Open navigation"]');
                            await page.waitForSelector('button[aria-label="Close navigation"]');
                        }
                        await clickText('button', 'Manage Posted Jobs');
                        await page.waitForSelector('.emp-manage-applicants-btn'); await page.click('.emp-manage-applicants-btn');
                    }
                    await page.waitForFunction(() => [...document.querySelectorAll('.emp-status-badge')].some(node => node.textContent.trim() === 'PENDING REVIEW'));
                    assert.equal(await count('Waiting for Review'), '1'); assert.equal(await count('For Interview'), '1');
                    assert.ok(await page.$$eval('h3,h5', nodes => nodes.every(node => !['Waiting for Approval', 'Approved Applicants'].includes(node.textContent))));
                    assert.ok((await page.$$eval('.emp-status-badge', nodes => nodes.map(node => node.textContent.trim()))).includes('FOR INTERVIEW'));
                    await page.evaluate(() => [...document.querySelectorAll('h3,h5')].find(node => node.textContent === 'Waiting for Review').closest('section').querySelector('button').click());
                    await page.waitForSelector('.applicant-details-dialog', { visible: true });
                    assert.equal(await page.$eval('.applicant-modal-actions [role="status"]', node => node.textContent), 'PENDING REVIEW');
                    assert.deepEqual(await page.$$eval('.applicant-modal-actions button', nodes => nodes.map(node => node.textContent)), ['For Interview', 'Decline']);
                    assert.ok(await page.$eval('.applicant-details-dialog .modal-body', node => node.scrollWidth <= node.clientWidth + 1), `${role} ${width}: modal fits`);
                    const before = await page.evaluate(() => window.puts.length);
                    await clickText('.applicant-modal-actions button', decision === 'verified' ? 'For Interview' : 'Decline');
                    await page.waitForFunction(() => [...document.querySelectorAll('.applicant-modal-actions button')].every(node => node.disabled));
                    const requests = await page.evaluate(() => window.puts.slice(-1));
                    assert.deepEqual(requests, [{ url: '/applications/1/review', body: { status: decision, job_id: 29, recruitment_cycle: 1 }, auth: true }]);
                    assert.equal(await page.evaluate(() => window.puts.length), before + 1);
                    assert.equal(await page.$eval('.applicant-modal-actions [role="status"]', node => node.textContent), decision === 'verified' ? 'FOR INTERVIEW' : 'DECLINED');
                    assert.equal(await count('Waiting for Review'), '0'); assert.equal(await count('For Interview'), decision === 'verified' ? '2' : '1');
                    const buttons = await page.$$eval('.applicant-modal-actions button', nodes => nodes.map(node => { const box = node.getBoundingClientRect(); return { left: box.left, right: box.right, width: box.width }; }));
                    assert.ok(buttons.every(box => box.left >= 0 && box.right <= width && box.width > 0), `${role} ${width}: both decision buttons remain inside the viewport`);
                    await page.click('.applicant-details-dialog .btn-close'); await page.waitForSelector('.applicant-details-dialog', { hidden: true });
                    console.log(JSON.stringify({ route, width, decision, labels: 'verified', originalRequestPreserved: true }));
                }
            }
            await page.goto(base + '/dashboard');
            assert.equal(await page.$eval('[data-route]', node => node.textContent), '/dashboard');
            await page.waitForSelector('.alu-dash-card'); await page.click('.alu-dash-card:nth-child(2)');
            await page.waitForFunction(() => document.querySelectorAll('.alu-status-badge').length === 3);
            assert.deepEqual(await page.$$eval('.alu-status-badge', nodes => nodes.map(node => node.textContent.trim())), ['PENDING REVIEW', 'FOR INTERVIEW', 'DECLINED']);
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${width}: alumni page has no overflow`);
        }
        assert.deepEqual(errors, []);
    } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
});
