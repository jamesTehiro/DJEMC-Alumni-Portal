import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';

test('shared academic fields, registrar records, CSV, queue and coordinator retain their workflows', async t => {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const output = await build({
        stdin: { resolveDir: root, loader: 'jsx', contents: `
            import React,{useState} from 'react'; import {createRoot} from 'react-dom/client';
            import {MemoryRouter} from 'react-router-dom';
            import {UndoDeleteProvider} from './src/context/UndoDeleteContext';
            import 'bootstrap/dist/css/bootstrap.min.css'; import './src/index.css';
            import AcademicProgramFields from './src/components/AcademicProgramFields';
            import MasterAlumniRecordsPanel from './src/components/MasterAlumniRecordsPanel';
            import AddAlumniModal from './src/components/AddAlumniModal';
            import CsvAlumniImportModal from './src/components/CsvAlumniImportModal';
            import Queue from './src/pages/RegistrarVerificationQueuePage';
            import Coordinator from './src/pages/AdminAlumniPage';
            import {programs,academicInfo} from './src/utils/academicPrograms';
            window.programs=programs;window.savedRecords=[];
            const records=[{id:1,full_name:'Business Alum',course:'BSBA',major:'Marketing Management',batch_year:2024},
                {id:2,full_name:'Second Business',course:'Bachelor of Science in Business Administration',major:'Financial Management',batch_year:2024},
                {id:3,full_name:'Legacy Alum',course:'BSED',major:null,batch_year:1998},
                {id:4,full_name:'Historical Alum',course:'AB',major:'Historical Service',batch_year:1995}];
            const users=records.map(record=>({id:record.id,name:record.full_name,role:'alumni',email:'fixture'+record.id+'@example.invalid',account_status:'verified',updatedAt:new Date().toISOString(),AlumniRecord:record,AlumniProfile:{course:'BSIT',major:null,graduation_year:2020,address:'Fixture Address',employment_status:'employed'}}));
            window.fixtureGet=async url=>url==='/admin/alumni/users'?users:url==='/alumni-records'?records:url==='/users/pending'?[{...users[0],account_status:'pending',AlumniProfile:{course:'BSBA',major:'Marketing Management',graduation_year:2024}}]:[];
            window.fixturePost=async(url,payload)=>{
                if(url!=='/alumni-records/import-csv')throw Error('Unexpected write attempt');
                if(payload.get('mode')!=='preview')throw Error('Only preview is exercised');
                return {mode:'preview',total:1,valid:1,errors:0,duplicates:0,issues:[],preview:[{row:2,...records[0]}]};
            };
            const view=new URL(location.href).searchParams.get('view')||'fields';
            localStorage.setItem('user',JSON.stringify({id:101,name:'Fixture Admin',role:'admin',admin_scope:view==='coordinator'?'alumni':'registrar'}));
            localStorage.setItem('token','local-fixture-token');
            function Fields(){const [value,setValue]=useState({course:'',major:''});return <form onSubmit={e=>{e.preventDefault();window.savedRecords.push(value);}}><AcademicProgramFields {...value} onChange={setValue}/><button>Submit</button><output>{JSON.stringify(value)}</output></form>}
            function Master(){const [editing,setEditing]=useState(null);return <><MasterAlumniRecordsPanel records={records} onEditRecord={setEditing} onDeleteRecord={()=>{}}/><AddAlumniModal show={!!editing} initialRecord={editing} onHide={()=>setEditing(null)} onSave={async value=>{window.savedRecords.push(value);setEditing(null);}}/></>}
            createRoot(document.getElementById('root')).render(<MemoryRouter>{view==='fields'?<Fields/>:view==='master'?<Master/>:view==='csv'?<CsvAlumniImportModal show onHide={()=>{}}/>:view==='queue'?<Queue/>:<UndoDeleteProvider><Coordinator/></UndoDeleteProvider>}</MemoryRouter>);
        ` }, bundle: true, write: false, outdir: 'fixture', format: 'iife', platform: 'browser', jsx: 'automatic',
        define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"test"' },
        plugins: [{ name: 'academic-fixture-api', setup(builder) {
            builder.onResolve({ filter: /\/services\/api$/ }, () => ({ path: 'api', namespace: 'fixture' }));
            builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const API_BASE_URL="http://fixture.invalid/api";export const resolveFileUrl=value=>value||"";export const fetchFile=()=>{throw Error("Unexpected private document fetch");};export const api={get:(...args)=>window.fixtureGet(...args),post:(...args)=>window.fixturePost(...args)};' }));
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
        browser = await puppeteer.launch({ headless: true, pipe: true, executablePath: process.env.PUPPETEER_EXECUTABLE_PATH });
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        const base = `http://127.0.0.1:${server.address().port}`;
        await page.setRequestInterception(true);
        page.on('request', request => request.url().startsWith(base + '/') ? request.continue() : request.abort());
        const view = async name => { await page.goto(base + '/?view=' + name); };
        const fill = async (selector, value) => page.$eval(selector, (element, value) => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, value);
            element.dispatchEvent(new Event('input', { bubbles: true }));
        }, value);
        await t.test('all configured programs/majors, historical inputs, required fields and stale selections', async () => {
            await view('fields'); await page.waitForSelector('select[name="course"]');
            for (const program of await page.evaluate(() => window.programs)) {
                await page.select('select[name="course"]', program.value);
                if (program.majors.length) {
                    assert.equal(await page.$eval('select[name="major"]', element => element.required && !element.validity.valid), true);
                    assert.deepEqual(await page.$$eval('select[name="major"] option', options => options.slice(1).map(option => option.value)), program.majors);
                    for (const major of program.majors) {
                        await page.select('select[name="major"]', major);
                        assert.deepEqual(await page.$eval('output', node => JSON.parse(node.textContent)), { course: program.value, major });
                    }
                } else assert.equal(await page.$('select[name="major"]'), null);
            }
            await page.select('select[name="course"]', 'BSBA'); await page.select('select[name="major"]', 'Operations Management');
            await page.select('select[name="course"]', 'BSIT');
            assert.deepEqual(await page.$eval('output', node => JSON.parse(node.textContent)), { course: 'BSIT', major: '' });
            await page.select('select[name="course"]', '__other');
            assert.equal(await page.$eval('input[name="previous_program"]', input => input.required), true);
            await fill('input[name="previous_program"]', 'AB'); await fill('input[name="major"]', 'Historical Service');
            assert.deepEqual(await page.$eval('output', node => JSON.parse(node.textContent)), { course: 'AB', major: 'Historical Service' });
            await fill('input[name="previous_program"]', 'BS in Information Technology');
            await page.waitForFunction(() => document.querySelector('output')?.textContent.includes('Information Technology'));
            assert.equal(await page.$eval('output', node => JSON.parse(node.textContent).major), '');
            assert.equal(await page.$('input[name="major"]'), null);
            for (const width of [1280, 390, 320]) {
                await page.setViewport({ width, height: 844 });
                assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
            }
        });
        await t.test('master records major search, program counts, edit and legacy majorless save', async () => {
            await page.setViewport({ width: 1280, height: 900 });
            await view('master'); await page.waitForSelector('.master-records-table-scroll');
            assert.ok((await page.$$eval('th', cells => cells.map(cell => cell.textContent))).includes('Major / Specialization'));
            assert.equal(await page.$eval('.master-records-metric:nth-child(2) strong', node => node.textContent), '3');
            await fill('input[aria-label="Search alumni records"]', 'Marketing Management');
            await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 1);
            assert.match(await page.$eval('tbody', node => node.textContent), /Business Alum/);
            await fill('input[aria-label="Search alumni records"]', '');
            await page.select('select[aria-label="Filter by major"]', 'Financial Management');
            await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 1);
            assert.match(await page.$eval('tbody', node => node.textContent), /Second Business/);
            await page.select('select[aria-label="Filter by major"]', '');
            await page.click('button[aria-label="Edit Legacy Alum"]');
            await page.waitForSelector('.modal.show');
            assert.equal(await page.$eval('select[name="major"]', node => node.required), false);
            await page.$eval('.modal-footer .btn-success', button => button.click());
            await page.waitForFunction(() => window.savedRecords.length === 1);
            assert.deepEqual(await page.evaluate(() => [window.savedRecords[0].course, window.savedRecords[0].major]), ['BSED', '']);
            await page.waitForSelector('.modal', { hidden: true });
            await page.click('button[aria-label="Edit Business Alum"]'); await page.waitForSelector('.modal.show');
            assert.equal(await page.$eval('select[name="major"]', node => node.required), true);
            await page.select('select[name="major"]', 'Financial Management');
            await page.$eval('.modal-footer .btn-success', button => button.click());
            await page.waitForFunction(() => window.savedRecords.length === 2);
            assert.equal(await page.evaluate(() => window.savedRecords[1].major), 'Financial Management');
        });
        await t.test('CSV template and read-only preview include major and preserve confirmation', async () => {
            await view('csv'); await page.waitForSelector('.modal.show');
            assert.match(decodeURIComponent(await page.$eval('a[download]', link => link.href)), /full_name,course,batch_year,major,student_id,email/);
            await page.$eval('input[type="file"]', input => { const transfer = new DataTransfer(); transfer.items.add(new File(['full_name,course,batch_year,major\nBusiness Alum,BSBA,2024,Marketing Management'], 'fixture.csv', { type: 'text/csv' })); input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true })); });
            await page.evaluate(() => [...document.querySelectorAll('.modal-footer button')].find(button => /Review CSV/.test(button.textContent)).click());
            await page.waitForSelector('.csv-alumni-import-preview');
            assert.match(await page.$eval('.csv-alumni-import-preview', node => node.textContent), /Major \/ Specialization/);
            assert.match(await page.$eval('.csv-alumni-import-preview', node => node.textContent), /Marketing Management/);
            assert.equal(await page.$$eval('.modal-footer button', buttons => buttons.filter(button => /Import/.test(button.textContent) && !button.disabled).length), 1);
        });
        await t.test('registrar queue shows submitted major and keeps selected-user review', async () => {
            await view('queue'); await page.waitForSelector('.rvq-row-actions button');
            assert.match(await page.$eval('.rvq-table-scroll tbody', node => node.textContent), /Business Administration \(BSBA\) — Marketing Management · Batch 2024/);
            await page.click('.rvq-row-actions button'); await page.waitForSelector('.rvq-user-details');
            assert.match(await page.$eval('.rvq-user-details', node => node.textContent), /Marketing Management/);
        });
        await t.test('coordinator active alumni searches official program and major while retaining address/status', async () => {
            await view('coordinator'); await page.waitForSelector('.metric-card-verified'); await page.click('.metric-card-verified');
            await page.waitForSelector('input[placeholder="Search name, program, major, address or employment"]');
            await fill('input[placeholder="Search name, program, major, address or employment"]', 'Marketing Management');
            await page.waitForFunction(() => document.querySelectorAll('.queue-table .queue-row:not(.header)').length === 1);
            const text = await page.$eval('.queue-table', node => node.textContent);
            assert.match(text, /Business Alum/); assert.match(text, /Marketing Management/); assert.match(text, /Fixture Address/); assert.match(text, /Active/);
        });
        assert.deepEqual(errors, []);
    } finally {
        if (browser) await browser.close();
        server.closeAllConnections?.();
        await new Promise(resolve => server.close(resolve));
    }
});
