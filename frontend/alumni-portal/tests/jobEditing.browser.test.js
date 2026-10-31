/* global process */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';

test('Employer and Employer Admin edit saved jobs with validation, cancellation, retry and responsive actions', async () => {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const bundle = await build({
        stdin: { resolveDir: root, loader: 'jsx', contents: `
            import React,{useState} from 'react'; import {createRoot} from 'react-dom/client';
            import {MemoryRouter} from 'react-router-dom';
            import 'bootstrap/dist/css/bootstrap.min.css'; import './src/styles/index.css';
            import EmployerPage from './src/features/dashboard/employer/EmployerPage';
            import AdminPage from './src/features/jobs/pages/AdminEmployerApplicantsPage';
            import {UndoDeleteProvider} from './src/contexts/UndoDeleteContext';
            import JobPostingForm from './src/features/jobs/components/JobPostingForm';
            import {createJobPostingForm} from './src/features/jobs/utils/jobPosting';
            import './src/styles/portal-responsive.css';
            const original={...createJobPostingForm(),id:44,employer_id:18,title:'Records Assistant',description:'Manage existing records',location:'Cebu City',employment_type:'part-time',course_target:'BSIT',recruitment_status:'closed',approval_status:'approved',createdAt:'2026-10-01',expected_salary:'Original salary',User:{id:18,name:'Original Owner',EmployerProfile:{organization_name:'Original Company'}},has_requirements:true,current_requirement_version:1};
            Object.assign(original.posting_details,{work_setup:'hybrid',vacancy_count:3,industry:'Education',company_description:'Company background',responsibilities:['Coordinate schedules'],preferred_qualifications:['HR certificate']});
            Object.assign(original.posting_details.required_qualifications,{education:'Bachelor degree',experience:'One year',skills:['Communication'],other:['Organized'],preferred_start_date:'2026-12-01'});
            Object.assign(original.posting_details.application,{instructions:'Use the portal',deadline:'2026-11-20',publish_contact:true,contact_email:'jobs@example.invalid',contact_number:'09123456789',walk_in_address:'Main office',office_hours:'9 to 5'});
            original.requirements=[{id:9,requirement_code:'custom_portfolio',label:'Portfolio',description:'Original instructions',requirement_type:'document_upload',value_type:'file',required:true,is_custom:true,allowed_types:'pdf',max_file_size:4096,sort_order:0,group_id:7}];
            original.requirement_groups=[{id:7,group_label:'Documents',sort_order:0}];
            window.jobs=[original,{...structuredClone(original),id:45,employer_id:77,title:'Other Employer Job',User:{name:'Other Owner',EmployerProfile:{organization_name:'Other Company'}}}];
            window.calls=[]; window.failSave=false; window.failLoad=false; window.createCount=0;
            window.getFixture=async(url,auth)=>{
                window.calls.push({method:'get',url,auth});
                if(url==='/jobs'||url==='/admin/employer/jobs')return structuredClone(window.jobs);
                if(url==='/profile')return {id:18,name:'Signed In User',EmployerProfile:{organization_name:'Current Account Company'}};
                if(url==='/jobs/44'||url==='/jobs/45'){
                    if(window.failLoad)throw Error('Unable to load job');
                    return structuredClone(window.jobs.find(job=>String(job.id)===url.split('/').pop()));
                }
                if(url==='/notifications'||url.startsWith('/applications/employer')||url==='/admin/employer/users'||url==='/admin/employer/applications')return [];
                throw Error('Unexpected GET '+url);
            };
            window.putFixture=async(url,payload,auth)=>{
                window.calls.push({method:'put',url,payload,auth});
                await new Promise(resolve=>window.finishSave=()=>{window.finishSave=null;resolve();});
                if(window.failSave)throw Error('Network unavailable. Try again.');
                const index=window.jobs.findIndex(job=>url==='/jobs/'+job.id);
                if(index<0)throw Error('Wrong job ID');
                window.jobs[index]={...window.jobs[index],...payload,posting_details:{...window.jobs[index].posting_details,...payload.posting_details}};
                return structuredClone(window.jobs[index]);
            };
            function Create(){const [form,setForm]=useState(()=>structuredClone(original));return <JobPostingForm value={form} onChange={setForm} requirements={original.requirements} profile={original.User} onPublish={async()=>{window.createCount++;return true;}}/>;}
            const root=createRoot(document.getElementById('root'));
            window.show=role=>{
                localStorage.setItem('user',JSON.stringify(role==='admin'?{id:27,role:'admin',admin_scope:'employer'}:{id:18,role:'employer'}));
                root.render(<MemoryRouter key={role} initialEntries={[role==='admin'?'/admin/employer/applicants':'/employer']}><UndoDeleteProvider>{role==='create'?<Create/>:role==='admin'?<AdminPage/>:<EmployerPage/>}</UndoDeleteProvider></MemoryRouter>);
            };
            window.show('employer');
        ` }, bundle: true, write: false, outdir: 'fixture', format: 'iife', platform: 'browser', jsx: 'automatic',
        loader: { '.png': 'dataurl', '.jpg': 'dataurl', '.svg': 'dataurl' },
        define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"test"' },
        plugins: [{ name: 'fixture-api', setup(builder) {
            builder.onResolve({ filter: /\/services\/api$/ }, () => ({ path: 'api', namespace: 'fixture' }));
            builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `
                export const API_BASE_URL='/api'; export const resolveFileUrl=url=>url;
                export const fetchFile=()=>{throw Error('Unexpected file request');};
                export const api={get:(...args)=>window.getFixture(...args),put:(...args)=>window.putFixture(...args),post:()=>{throw Error('Editing cannot POST a job');},delete:()=>{throw Error('Editing cannot delete a job');}};
            ` }));
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
    const screenshots = path.join(root, '../../tmp/edit-job/screenshots'); mkdirSync(screenshots, { recursive: true });
    let browser;
    try {
        browser = await puppeteer.launch({ headless: true, pipe: true, executablePath: process.env.PUPPETEER_EXECUTABLE_PATH });
        const page = await browser.newPage(), errors = [], dialogs = [];
        let discard = false;
        page.on('pageerror', error => errors.push(error.message));
        page.on('dialog', async dialog => { dialogs.push(dialog.message()); if (discard) await dialog.accept(); else await dialog.dismiss(); });
        await page.setRequestInterception(true);
        page.on('request', request => /^(http:\/\/127\.0\.0\.1:|data:)/.test(request.url()) ? request.continue() : request.abort());
        await page.setViewport({ width: 1280, height: 1000 });
        await page.goto(`http://127.0.0.1:${server.address().port}`);
        const clickText = async (selector, text) => {
            const handle = await page.evaluateHandle((selector, text) => [...document.querySelectorAll(selector)].find(node => node.textContent.trim() === text), selector, text);
            assert.ok(handle.asElement(), `button exists: ${text}`); await handle.asElement().click(); await handle.dispose();
        };
        const replaceField = async (label, text) => {
            const handle = await page.evaluateHandle(label => [...document.querySelectorAll('.job-posting-form label')].find(node => node.textContent.replace(/\s*\*$/, '').trim() === label)?.control, label);
            assert.ok(handle.asElement(), `field exists: ${label}`);
            await handle.asElement().click(); await handle.evaluate(node => node.select()); await page.keyboard.press('Backspace'); if (text) await handle.asElement().type(text); await handle.dispose();
        };
        for (const role of ['employer', 'admin']) {
            if (role === 'admin') await page.evaluate(() => window.show('admin'));
            else { await page.waitForSelector('.emp-dash-card'); await clickText('button', 'Manage Posted Jobs'); }
            await page.waitForSelector('.emp-edit-job-btn');
            assert.equal(await page.$$eval('.emp-edit-job-btn', nodes => nodes.length), role === 'employer' ? 1 : 2, 'each permitted job has Edit Job');
            for (const width of [320, 375, 768, 1280]) {
                await page.setViewport({ width, height: 1000 });
                const cards = await page.$$eval('.employer-manage-jobs-page .emp-list-item', nodes => nodes.map(node => {
                    const box = node.getBoundingClientRect(); return { left: box.left, right: box.right, buttons: [...node.querySelectorAll('button')].map(button => { const b = button.getBoundingClientRect(); return { left: b.left, right: b.right, width: b.width, height: b.height, label: button.textContent || button.getAttribute('aria-label') }; }) };
                }));
                assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${role} ${width}: no page overflow`);
                for (const card of cards) for (const button of card.buttons) assert.ok(button.left >= card.left - 1 && button.right <= card.right + 1 && button.right <= width && button.height > 0, `${role} ${width}: ${button.label} fits`);
                await page.screenshot({ path: path.join(screenshots, `${role}-list-${width}.png`), fullPage: true });
            }
            await page.click('.emp-edit-job-btn');
            await page.waitForSelector('.job-posting-edit-dialog .job-posting-form');
            const values = await page.$$eval('.job-posting-form label[for]', nodes => Object.fromEntries(nodes.filter(node => node.control).map(node => [node.textContent.replace(/\s*\*$/, '').trim(), node.control.value])));
            for (const [label, expected] of Object.entries({ 'Job Title': role === 'employer' ? 'Records Assistant' : 'Corrected employer title', 'Job Location': 'Cebu City', 'Employment Type': 'part-time', 'Work Setup': 'hybrid', 'Number of Vacancies (optional)': '3', 'Company / Organization': 'Original Company', 'Industry (optional)': 'Education', 'Company Description (optional)': 'Company background', 'Required Education (optional)': 'Bachelor degree', 'Required Experience (optional)': 'One year', 'Academic Program / Qualification (optional)': 'BSIT', 'Preferred Start Date (optional)': '2026-12-01', 'Application Deadline (optional)': '2026-11-20', 'Additional Application Instructions (optional)': 'Use the portal', 'Contact Email (optional)': 'jobs@example.invalid', 'Label': 'Portfolio', 'Allowed Types': 'pdf' })) assert.equal(values[label], expected, label);
            assert.ok(await page.$eval('input[readonly]', node => node.readOnly), 'owner identity is read-only');
            assert.doesNotMatch(await page.$eval('.job-posting-form', node => node.textContent), /Salary & Benefits|Technical \/ Vocational/);
            await clickText('.job-posting-form button', 'Cancel');
            await page.waitForSelector('.job-posting-edit-dialog', { hidden: true });
            await page.click('.emp-edit-job-btn'); await page.waitForSelector('.job-posting-form');
            await replaceField('Job Title', 'Unsaved title');
            await clickText('.job-posting-form button', 'Cancel');
            assert.ok(await page.$('.job-posting-edit-dialog'), 'declining discard retains draft');
            discard = true; await clickText('.job-posting-form button', 'Cancel'); discard = false;
            await page.waitForSelector('.job-posting-edit-dialog', { hidden: true });
            const before = await page.evaluate(() => window.calls.filter(call => call.method === 'put').length);
            await page.click('.emp-edit-job-btn'); await page.waitForSelector('.job-posting-form');
            await replaceField('Job Title', ''); await clickText('.job-posting-form button', 'Save Changes');
            await page.waitForSelector('.job-posting-errors');
            assert.equal(await page.evaluate(() => window.calls.filter(call => call.method === 'put').length), before, 'cancel and invalid form never save');
            await replaceField('Job Title', `Corrected ${role} title`);
            if (role === 'admin') {
                await replaceField('Label', 'Updated portfolio');
                await clickText('.job-posting-form button', '+ Custom Requirement');
                assert.equal(await page.$$eval('.job-requirements-item', nodes => nodes.length), 2);
                await page.click('button[aria-label="Remove application requirement 2"]');
            }
            await page.setViewport({ width: 320, height: 1000 });
            assert.ok(await page.$eval('.job-posting-edit-dialog .modal-body', node => node.scrollWidth <= node.clientWidth + 1), `${role}: mobile form fits without horizontal scrolling`);
            await page.screenshot({ path: path.join(screenshots, `${role}-edit-mobile.png`), fullPage: true });
            await page.evaluate(() => { window.failSave = true; });
            await clickText('.job-posting-form button', 'Save Changes');
            await page.waitForFunction(() => typeof window.finishSave === 'function');
            await page.$eval('.job-posting-form', node => node.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
            assert.equal(await page.evaluate(() => window.calls.filter(call => call.method === 'put').length), before + 1, 'duplicate submit blocked');
            assert.ok(await page.$eval('.job-posting-form fieldset', node => node.disabled));
            await page.keyboard.press('Escape'); assert.ok(await page.$('.job-posting-edit-dialog'), 'saving blocks closing');
            await page.evaluate(() => window.finishSave());
            await page.waitForFunction(() => document.querySelector('.job-posting-edit-dialog')?.textContent.includes('Network unavailable'));
            assert.equal(await page.$eval('.job-posting-form input', node => node.value), `Corrected ${role} title`, 'failed save retains values');
            await page.evaluate(() => { window.failSave = false; }); await clickText('.job-posting-form button', 'Save Changes');
            await page.waitForFunction(() => typeof window.finishSave === 'function'); await page.evaluate(() => window.finishSave());
            await page.waitForSelector('.job-posting-edit-dialog', { hidden: true });
            await page.waitForFunction(() => document.querySelector('.job-posting-update-toast')?.textContent.includes('Job posting updated successfully.'));
            assert.match(await page.$eval('.employer-manage-jobs-page', node => node.textContent), new RegExp(`Corrected ${role} title`));
            const saved = await page.evaluate(() => ({ job: window.jobs[0], count: window.jobs.length, request: window.calls.filter(call => call.method === 'put').at(-1) }));
            assert.equal(saved.count, 2); assert.equal(saved.job.id, 44); assert.equal(saved.job.employer_id, 18); assert.equal(saved.job.recruitment_status, 'closed'); assert.equal(saved.job.approval_status, 'approved');
            assert.equal(saved.request.url, '/jobs/44'); assert.equal(saved.request.auth, true);
            if (role === 'employer') assert.equal(saved.request.payload.requirements, undefined, 'unchanged requirements are preserved without a new version');
            else {
                assert.equal(saved.request.payload.requirements[0].label, 'Updated portfolio');
                assert.equal(saved.request.payload.requirements[0].description, 'Original instructions');
                assert.equal(saved.request.payload.requirements[0].max_file_size, 4096);
                assert.equal(saved.request.payload.requirements[0].group_temp_id, 'group_7');
                assert.equal(saved.request.payload.groups[0].label, 'Documents');
            }
        }
        assert.equal(dialogs.length, 4); assert.ok(dialogs.every(message => /Discard unsaved/.test(message)));
        await page.evaluate(() => window.show('create'));
        await page.waitForSelector('.job-posting-form'); await clickText('.job-posting-form button', 'Preview Job Posting');
        await page.waitForSelector('.job-posting-preview-heading'); assert.equal(await page.evaluate(() => window.createCount), 0);
        await clickText('.job-posting-form button', 'Publish Job'); await page.waitForFunction(() => window.createCount === 1);
        assert.deepEqual(errors, []);
    } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
});
