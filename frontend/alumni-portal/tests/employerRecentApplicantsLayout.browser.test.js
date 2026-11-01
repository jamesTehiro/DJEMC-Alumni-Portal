/* global process */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';

test('Recent Applicants fits small phones through desktop, with working search and View controls', async () => {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const bundle = await build({
        stdin: { resolveDir: root, loader: 'jsx', contents: `
            import React from 'react';
            import {createRoot} from 'react-dom/client';
            import {MemoryRouter} from 'react-router-dom';
            import 'bootstrap/dist/css/bootstrap.min.css';
            import './src/styles/index.css';
            import EmployerPage from './src/features/dashboard/employer/EmployerPage';
            import {UndoDeleteProvider} from './src/contexts/UndoDeleteContext';
            import './src/styles/portal-responsive.css';
            localStorage.setItem('user',JSON.stringify({id:90,role:'employer',name:'Fixture Employer'}));
            const applications=[
                {id:1,full_name:'Alicia '+ 'LongApplicantName'.repeat(7),status:'pending',Job:{title:'Senior '+ 'LongJobTitle'.repeat(9)}},
                {id:2,full_name:'Ben Approved Applicant',status:'verified',Job:{title:'Software Developer'}},
                {id:3,full_name:'Carla Rejected Applicant',status:'rejected',Job:{title:'Customer Service Representative and Operations Coordinator'}},
                {id:4,full_name:'James sande tehiro',status:'not_verified',Job:{title:'ergergerg'}}
            ].map(app=>({...app,createdAt:'2026-10-13T08:00:00Z',alumni:{id:app.id,name:app.full_name},ApplicationDocuments:[]}));
            window.fixtureCalls=[];
            window.fixtureGet=async(url,auth)=>{
                window.fixtureCalls.push({url,auth});
                if(url==='/jobs'||url==='/notifications'||url==='/applications/employer?archived=true')return [];
                if(url==='/profile')return {id:90,name:'Fixture Employer',EmployerProfile:{company_name:'Fixture Company'}};
                if(url==='/applications/employer')return applications;
                if(url.startsWith('/profile/'))return {id:Number(url.split('/').pop()),AlumniProfile:{}};
                throw Error('Unexpected fixture API: '+url);
            };
            createRoot(document.getElementById('root')).render(
                <MemoryRouter initialEntries={['/employer']}><UndoDeleteProvider><EmployerPage/></UndoDeleteProvider></MemoryRouter>
            );
        ` },
        bundle: true, write: false, outdir: 'fixture', format: 'iife', platform: 'browser', jsx: 'automatic',
        loader: { '.png': 'dataurl', '.svg': 'dataurl' },
        define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"test"' },
        plugins: [{ name: 'fixture-api', setup(builder) {
            builder.onResolve({ filter: /\/services\/api$/ }, () => ({ path: 'api', namespace: 'fixture' }));
            builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `
                export const API_BASE_URL='/api';
                export const resolveFileUrl=url=>url;
                export const fetchFile=()=>{throw Error('Unexpected file request');};
                export const api={get:(...args)=>window.fixtureGet(...args)};
            ` }));
        } }], logLevel: 'silent'
    });
    const script = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
    const css = bundle.outputFiles.find(file => file.path.endsWith('.css')).text
        .replace(/@import\s+url\([^;]+;/g, '') + '\n*,*::before,*::after{animation:none!important;transition:none!important;}';
    const server = createServer((req, res) => {
        if (req.url === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(script); }
        else if (req.url === '/styles.css') { res.setHeader('Content-Type', 'text/css'); res.end(css); }
        else res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><div id="root"></div><script src="/bundle.js"></script>');
    }).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const artifacts = path.join(root, '../../tmp/employer-recent-applicants');
    mkdirSync(artifacts, { recursive: true });
    let browser;
    try {
        browser = await puppeteer.launch({ headless: true, pipe: true, executablePath: process.env.PUPPETEER_EXECUTABLE_PATH });
        const page = await browser.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.setRequestInterception(true);
        page.on('request', request => request.url().startsWith('http://127.0.0.1:') || request.url().startsWith('data:') ? request.continue() : request.abort());
        await page.setViewport({ width: 1440, height: 1000 });
        await page.goto(`http://127.0.0.1:${server.address().port}`);
        await page.waitForFunction(() => [...document.querySelectorAll('.emp-dash-card-label')].some(node => node.textContent === 'Applicants'));
        await page.evaluate(() => [...document.querySelectorAll('.emp-dash-card-label')].find(node => node.textContent === 'Applicants').closest('button').click());
        await page.waitForFunction(() => document.querySelectorAll('.employer-record-item').length === 4);
        const results = [];
        for (const width of [1440, 1024, 316, 320, 375, 425, 768]) {
            await page.setViewport({ width, height: 1000 });
            await page.$eval('.employer-record-list', node => { node.scrollTop = 0; });
            const layout = await page.evaluate(() => {
                const bounds = node => {
                    const { left, right, top, bottom, width, height } = node.getBoundingClientRect();
                    return { left, right, top, bottom, width, height };
                };
                const list = document.querySelector('.employer-record-list');
                return {
                    pageOverflow: document.documentElement.scrollWidth > innerWidth,
                    list: { ...bounds(list), clientWidth: list.clientWidth, scrollWidth: list.scrollWidth },
                    rows: [...list.children].map(node => ({
                        card: bounds(node), details: bounds(node.querySelector('.emp-list-item-left')),
                        name: node.querySelector('strong').textContent,
                        info: node.querySelector('p').textContent,
                        textOverflow: [...node.querySelectorAll('strong,p')].some(text => text.scrollWidth > text.clientWidth + 1),
                        controls: bounds(node.querySelector('.emp-list-item-right')),
                        badge: { ...bounds(node.querySelector('.emp-status-badge')), text: node.querySelector('.emp-status-badge').textContent },
                        view: bounds(node.querySelector('.emp-view-btn')),
                        direction: getComputedStyle(node).flexDirection
                    }))
                };
            });
            results.push({ width, ...layout });
            writeFileSync(path.join(artifacts, 'measurements.json'), JSON.stringify(results, null, 2));
            await page.screenshot({ path: path.join(artifacts, `${width}.png`), fullPage: true });
            console.log(JSON.stringify({ width, pageOverflow: layout.pageOverflow, listOverflow: layout.list.scrollWidth - layout.list.clientWidth, firstRow: layout.rows[0] }));
            assert.equal(layout.pageOverflow, false, `${width}: page has no horizontal overflow`);
            assert.ok(layout.list.scrollWidth <= layout.list.clientWidth + 1, `${width}: list has no horizontal overflow`);
            assert.deepEqual(layout.rows.map(row => row.badge.text), ['PENDING REVIEW', 'FOR INTERVIEW', 'REJECTED', 'DECLINED']);
            for (const row of layout.rows) {
                assert.ok(row.name && row.info.includes('Applied') && row.info.includes('2026'), `${width}: name, job and date remain visible`);
                assert.equal(row.textOverflow, false, `${width}: long names and job titles wrap`);
                for (const box of [row.card, row.details, row.controls, row.badge, row.view]) {
                    assert.ok(box.width > 0 && box.height > 0 && box.left >= layout.list.left - 1 && box.right <= layout.list.right + 1 && box.right <= width, `${width}: each row and control fits the list and viewport`);
                }
                assert.ok(row.view.bottom <= row.card.bottom + 1 && row.badge.bottom <= row.card.bottom + 1, `${width}: controls fit within card height`);
                if (width <= 768) {
                    assert.equal(row.direction, 'column');
                    assert.ok(row.controls.top >= row.details.bottom, `${width}: status and View follow applicant details`);
                    assert.ok(row.card.height - row.details.height - row.controls.height <= 50, `${width}: no flex-basis gap`);
                    assert.ok(row.view.height >= 44 && row.view.width >= 44, `${width}: View has a touch-friendly target`);
                } else {
                    assert.equal(row.direction, 'row');
                    assert.ok(row.controls.left >= row.details.right, `${width}: desktop controls stay alongside details`);
                }
            }
            // Exercise the real search input and click View, including on the smallest viewport.
            const search = await page.$('input[aria-label="Search applicants"]');
            await search.click();
            await search.evaluate(node => node.select());
            await page.keyboard.press('Backspace');
            await search.type('James');
            await page.waitForFunction(() => document.querySelectorAll('.employer-record-item').length === 1);
            await page.click('.employer-record-item .emp-view-btn');
            await page.waitForSelector('.applicant-details-dialog', { visible: true });
            assert.match(await page.$eval('.applicant-details-dialog', node => node.textContent), /James sande tehiro/);
            await page.click('.applicant-details-dialog .btn-close');
            await page.waitForSelector('.applicant-details-dialog', { hidden: true });
            await search.click();
            await search.evaluate(node => node.select());
            await page.keyboard.press('Backspace');
            await search.type('no matching applicant');
            await page.waitForFunction(() => document.querySelector('.emp-dash-empty')?.textContent.includes('No applicants match'));
            await search.click();
            await search.evaluate(node => node.select());
            await page.keyboard.press('Backspace');
            await page.waitForFunction(() => document.querySelectorAll('.employer-record-item').length === 4);
        }
        assert.ok(await page.evaluate(() => window.fixtureCalls.some(call => call.url === '/profile/4' && call.auth === true)), 'View retains the authenticated profile lookup');
        assert.deepEqual(errors, []);
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
});
