import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';

test('saved Digital Resume status matches employment cards; detail refresh preserves the 31-graduate total and table filters', async () => {
    const result = await build({
        stdin: { resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'jsx', contents: `
            import React from 'react';import {createRoot} from 'react-dom/client';
            import {MemoryRouter,Routes,Route,useNavigate} from 'react-router-dom';
            import AdminUsersPage from './src/features/alumni-records/pages/AdminUsersPage';
            import ProfilePage from './src/features/profiles/pages/ProfilePage';
            import {graduateEmploymentMetrics} from '../../backend/utils/graduateEmploymentMetrics';
            import 'bootstrap/dist/css/bootstrap.min.css';import './src/styles/index.css';import './src/styles/portal-responsive.css';
            const alumni={id:12,name:'Digital Resume Alumni',role:'alumni',account_status:'verified',alumni_record_id:1,
                AlumniRecord:{id:1,full_name:'Digital Resume Alumni',course:'BSIT',major:null,batch_year:2024},
                AlumniProfile:{user_id:12,course:'BSIT',graduation_year:2024,employment_status:null,profile_visibility:'public',EmploymentHistories:[{company_name:'Past Employer',position:'Old role',employment_type:'Full-time',start_year:2020,end_year:2021}]}};
            const official=Array.from({length:31},(_,index)=>({id:index+1,User:index===0?alumni:null}));
            window.summaryCalls=0;window.summaryTotal=31;window.failSummary=false;window.fixtureGets=[];
            window.fixturePut=async(url,body)=>{if(url!=='/profile')throw Error('Unexpected write');alumni.AlumniProfile.employment_status=body.employment_status;return {user:structuredClone(alumni)};};
            window.fixtureGet=async(url,auth)=>{
                window.fixtureGets.push(url);
                if(!auth)throw Error('Missing authentication');
                if(url==='/admin/alumni/users')return [structuredClone(alumni)];
                if(url==='/admin/alumni/tracking-summary'){window.summaryCalls++;window.lastSummaryTime=Date.now();if(window.failSummary)throw Error('Fixture summary unavailable');return {totalGraduates:window.summaryTotal,...graduateEmploymentMetrics(official)};}
                if(url==='/admin/alumni/users/12/tracking')return {alumni:structuredClone(alumni),requests:[],events:[]};
                if(url==='/profile/12')return structuredClone(alumni);
                throw Error('Unexpected GET '+url);
            };
            localStorage.setItem('user',JSON.stringify({id:101,name:'Fixture Admin',role:'admin',admin_scope:'alumni'}));
            localStorage.setItem('token','local-fixture');
            function App(){const navigate=useNavigate();window.fixtureNavigate=path=>{
                localStorage.setItem('user',JSON.stringify(path.startsWith('/profile')
                    ?{id:12,name:'Digital Resume Alumni',role:'alumni'}:{id:101,name:'Fixture Admin',role:'admin',admin_scope:'alumni'}));
                navigate(path);
            };return <Routes>
                <Route path="/admin/alumni/users" element={<AdminUsersPage role="alumni"/>}/>
                <Route path="/profile/:userId" element={<ProfilePage/>}/>
            </Routes>;}
            createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={['/admin/alumni/users']}><App/></MemoryRouter>);
        ` }, bundle: true, write: false, outdir: 'fixture', format: 'iife', platform: 'browser', jsx: 'automatic',
        loader: { '.png': 'dataurl', '.jpg': 'dataurl', '.svg': 'dataurl' },
        define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"test"' },
        plugins: [{ name: 'fixture-api', setup(builder) {
            builder.onResolve({ filter: /\/services\/api$/ }, () => ({ path: 'api', namespace: 'fixture' }));
            builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `export const API_BASE_URL='/api';export const resolveFileUrl=value=>value||'';export const api={get:(...args)=>window.fixtureGet(...args),put:(...args)=>window.fixturePut(...args)};` }));
        } }], logLevel: 'silent'
    });
    const script = result.outputFiles.find(file => file.path.endsWith('.js')).text;
    const css = result.outputFiles.find(file => file.path.endsWith('.css')).text.replace(/@import[^;]+;/g, '');
    const server = createServer((req, res) => {
        if (req.url === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(script); }
        else if (req.url === '/style.css') { res.setHeader('Content-Type', 'text/css'); res.end(css); }
        else res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/bundle.js"></script>');
    }).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    let browser;
    try {
        browser = await puppeteer.launch({ headless: true, pipe: true, executablePath: process.env.PUPPETEER_EXECUTABLE_PATH });
        const page = await browser.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.setRequestInterception(true);
        page.on('request', request => request.url().startsWith(`http://127.0.0.1:${server.address().port}`) || request.url().startsWith('data:') ? request.continue() : request.abort());
        await page.setViewport({ width: 1440, height: 1000 });
        await page.goto(`http://127.0.0.1:${server.address().port}`);
        const cards = () => page.$$eval('.alumni-tracking-summary strong', nodes => nodes.map(node => node.textContent));
        await page.waitForFunction(() => document.querySelector('.alumni-tracking-summary strong')?.textContent === '31');
        assert.deepEqual(await cards(), ['31', '0', '0', '0']);
        for (const [status, expected] of [['employed', ['1', '0', '0']], ['unemployed', ['0', '1', '0']], ['self-employed', ['0', '0', '1']], [null, ['0', '0', '0']], ['Unknown', ['0', '0', '0']]]) {
            await page.evaluate(status => window.fixturePut('/profile', { employment_status: status }), status);
            await page.evaluate(() => window.fixtureNavigate('/profile/12'));
            try { await page.waitForFunction(() => document.querySelector('.resume-preview')?.textContent.includes('Employment Status:')); }
            catch {
                const diagnostic = await page.evaluate(() => ({ requests: window.fixtureGets, body: document.body.innerText.slice(0, 2500) }));
                assert.fail(JSON.stringify({ ...diagnostic, errors }));
            }
            const previewStatus = await page.$eval('.resume-preview', node => [...node.querySelectorAll('p')]
                .find(item => item.textContent.includes('Employment Status:'))?.textContent.replace(/^\s*Employment Status:\s*/, '').trim());
            assert.equal(previewStatus, status || 'Not specified');
            // Test-only rapid role/page switches must respect the existing
            // 1.2-second duplicate-initialization guard used by this page.
            await page.waitForFunction(() => Date.now() - window.lastSummaryTime > 1250);
            await page.evaluate(() => window.fixtureNavigate('/admin/alumni/users'));
            await page.waitForFunction(() => document.querySelector('.alumni-tracking-summary strong')?.textContent === '31');
            assert.deepEqual(await cards(), ['31', ...expected]);
        }
        await page.type('input[aria-label="Search alumni records"]', 'Digital');
        const originalTable = await page.$eval('.alumni-tracking-table', node => node.textContent);
        await page.evaluate(() => { window.fixturePut('/profile', { employment_status: 'self-employed' }); window.summaryTotal = 999; });
        await page.click('.alumni-profile-view-button');
        await page.waitForFunction(() => document.querySelectorAll('.alumni-tracking-summary strong')[3]?.textContent === '1');
        assert.deepEqual(await cards(), ['31', '0', '0', '1'], 'detail refresh only changes employment metrics');
        assert.equal(await page.$eval('input[aria-label="Search alumni records"]', node => node.value), 'Digital');
        assert.equal(await page.$eval('.alumni-tracking-table', node => node.textContent), originalTable);
        assert.ok(await page.evaluate(() => window.summaryCalls >= 7));
        assert.deepEqual(errors, []);
    } finally {
        await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    }
});
