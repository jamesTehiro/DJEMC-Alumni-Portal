import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';

test('Alumni Records separates academic fields and preserves table/profile workflows', async (t) => {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const result = await build({
        stdin: { resolveDir: root, loader: 'jsx', contents: `
            import React from 'react'; import {createRoot} from 'react-dom/client';
            import {MemoryRouter} from 'react-router-dom';
            import 'bootstrap/dist/css/bootstrap.min.css'; import './src/index.css';
            import AdminUsersPage from './src/pages/admin/AdminUsersPage';
            import './src/portal-responsive.css';
            const names=['Alpha Verified','Bravo Pending','Charlie Rejected','Delta Suspended','Echo Deactivated','Foxtrot Missing','Golf Custom','Hotel Empty','India Requested','Juliet Graduate','Kilo Graduate','Lima Graduate'];
            const statuses=['verified','pending','rejected','suspended','deactivated',null,'Manual review','','verified','verified','verified','verified'];
            const records=names.map((name,index)=>({id:index+1,name,role:'alumni',account_status:statuses[index],
                AlumniRecord:{full_name:name,course:index===1?'CRIM':'BSIT',major:null,batch_year:index===1?2026:2025},
                AlumniProfile:{course:'BSBA',major:'Marketing Management',graduation_year:2020,employment_status:index===2?'unemployed':'employed',
                    profile_visibility:'public',updatedAt:'2020-01-01T00:00:00Z',job_title:'Developer',current_company:index===0?'Fixture Labs':'Example Company'}
            }));
            records[0].name='Old account name';
            records[0].latestProfileUpdateRequest={status:'failed'};
            records[1].email_verified_at='2026-01-01T00:00:00Z';
            records[1].AlumniProfile.profile_visibility='private';
            records[5].AlumniRecord=null; records[5].AlumniProfile.graduation_year=2023;
            records[7].AlumniRecord=null; records[7].AlumniProfile={};
            records[8].latestProfileUpdateRequest={status:'sent'};
            window.fixtureCalls=[];
            window.fixtureGet=(url,auth)=>{
                if(!auth)throw Error('Missing existing authenticated API flag');
                window.fixtureCalls.push(url);
                if(url==='/admin/alumni/users')return new Promise(resolve=>{window.releaseRecords=()=>resolve([...records].reverse());});
                if(url==='/admin/alumni/tracking-summary')return Promise.resolve({totalGraduates:24,employed:15,unemployed:6,selfEmployed:3});
                const match=url.match(/^\\/admin\\/alumni\\/users\\/(\\d+)\\/tracking$/);
                if(match){
                    const alumni=JSON.parse(JSON.stringify(records.find(record=>record.id===Number(match[1]))));
                    if(alumni.AlumniProfile.profile_visibility==='private'){
                        alumni.AlumniProfile.job_title=null; alumni.AlumniProfile.current_company=null;
                    }else alumni.AlumniProfile.EmploymentHistories=[{id:alumni.id,position:'Developer',company_name:'Fixture Labs',start_year:2021,is_current:true}];
                    return new Promise(resolve=>{window.releaseTracking=()=>resolve({alumni,requests:[],events:[{id:alumni.id,action:'alumni.account_status.changed',metadata:{from:'pending',to:alumni.account_status},created_at:'2025-01-01T00:00:00Z'}]});});
                }
                throw Error('Unexpected API request: '+url);
            };
            localStorage.setItem('user',JSON.stringify({id:101,name:'Fixture Admin',role:'admin',admin_scope:'alumni'}));
            localStorage.setItem('token','local-fixture-token');
            createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={['/admin/alumni/users']}><AdminUsersPage role="alumni"/></MemoryRouter>);
        ` },
        bundle: true, write: false, outdir: 'fixture', format: 'iife', platform: 'browser', jsx: 'automatic',
        define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"test"' },
        plugins: [{ name: 'records-fixture-api', setup(builder) {
            builder.onResolve({ filter: /\/services\/api$/ }, () => ({ path: 'api', namespace: 'fixture' }));
            builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const API_BASE_URL="http://fixture.invalid/api"; export const resolveFileUrl=value=>value||""; export const api={get:(...args)=>window.fixtureGet(...args),post:()=>{throw Error("Unexpected write");}};' }));
        } }], logLevel: 'silent'
    });
    const bundle = result.outputFiles.find(file => file.path.endsWith('.js')).text;
    const css = result.outputFiles.find(file => file.path.endsWith('.css')).text.replace(/@import[^;]+;/g, '');
    const server = createServer((req, res) => {
        if (req.url === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle); }
        else if (req.url === '/styles.css') { res.setHeader('Content-Type', 'text/css'); res.end(css); }
        else res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><div id="root"></div><script src="/bundle.js"></script>');
    }).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    let browser;
    try {
        browser = await puppeteer.launch({ headless: true, pipe: true, executablePath: process.env.PUPPETEER_EXECUTABLE_PATH });
        const page = await browser.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        const origin = `http://127.0.0.1:${server.address().port}`;
        await page.setRequestInterception(true);
        page.on('request', request => request.url().startsWith(origin + '/') ? request.continue() : request.abort());
        await page.setViewport({ width: 1440, height: 1000 });
        await page.goto(origin);
        const rows = () => page.$$eval('.alumni-tracking-table tbody tr', items => items.map(row => [...row.cells].map(cell => cell.textContent.trim())));
        const select = async (label, value) => { await page.select(`select[aria-label="${label}"]`, value); };
        const search = async value => {
            await page.$eval('input[aria-label="Search alumni records"]', (input, value) => {
                Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
                input.dispatchEvent(new Event('input', { bubbles: true }));
            }, value);
        };
        const clickText = async (selector, text) => page.evaluate((selector, text) => {
            const button = [...document.querySelectorAll(selector)].find(button => button.textContent.trim() === text);
            if (!button) throw Error('Missing button: ' + text);
            button.click();
        }, selector, text);
        const screenshots = path.join(root, '../../tmp/alumni-records-ui');
        mkdirSync(screenshots, { recursive: true });

        await t.test('loading, columns, source priority, statuses and pagination', async () => {
            await page.waitForFunction(() => typeof window.releaseRecords === 'function');
            assert.equal(await page.$eval('.alumni-tracking-empty', cell => cell.colSpan), 6);
            await page.evaluate(() => window.releaseRecords());
            await page.waitForFunction(() => document.querySelectorAll('.alumni-profile-view-button').length === 10);
            assert.deepEqual(await page.$$eval('.alumni-tracking-table th', cells => cells.map(cell => cell.textContent)), ['Alumnus', 'Academic Year', 'Program', 'Major / Specialization', 'Account Status', 'Actions']);
            assert.deepEqual((await rows())[0].slice(1), ['2025', 'BS in Information Technology (BSIT)', 'Not recorded', 'Verified', 'View Profile']);
            assert.equal((await rows())[0][0], 'Alpha Verified');
            await clickText('.alumni-tracking-pagination button', 'Next');
            await page.waitForFunction(() => document.querySelectorAll('.alumni-profile-view-button').length === 2);
            assert.match((await rows())[0][0], /^Kilo/);
            await clickText('.alumni-tracking-pagination button', 'Previous');
            await page.select('.alumni-tracking-pagination select', '25');
            await page.waitForFunction(() => document.querySelectorAll('.alumni-profile-view-button').length === 12);
            const values = await rows();
            assert.ok(values.every(row => row.length === 6));
            assert.deepEqual(values.map(row => row[0]), ['Alpha Verified', 'Bravo Pending', 'Charlie Rejected', 'Delta Suspended', 'Echo Deactivated', 'Foxtrot Missing', 'Golf Custom', 'Hotel Empty', 'India Requested', 'Juliet Graduate', 'Kilo Graduate', 'Lima Graduate']);
            assert.equal(await page.$$eval('.alumni-tracking-table tbody td:first-child small', elements => elements.length), 0);
            assert.deepEqual(values.map(row => row[4]), ['Verified', 'Pending', 'Rejected', 'Suspended', 'Deactivated', 'Not available', 'Manual review', 'Not available', 'Verified', 'Verified', 'Verified', 'Verified']);
            assert.deepEqual(values[1].slice(1, 5), ['2026', 'BS in Criminology (BSCRIM)', 'Not recorded', 'Pending']);
            assert.deepEqual(values[5].slice(1, 5), ['2023', 'BS in Business Administration (BSBA)', 'Marketing Management', 'Not available']);
            assert.deepEqual(values[7].slice(1, 5), ['Year not recorded', 'Not recorded', 'Not recorded', 'Not available']);
            assert.deepEqual(await page.$$eval('.alumni-tracking-summary strong', cards => cards.map(card => card.textContent)), ['24', '15', '6', '3']);
            assert.equal(await page.$eval('.alumni-profile-view-button', button => button.className), 'alumni-profile-view-button');
            // The existing .queue-panel button rule wins over the single-class
            // table button rule; preserve that effective appearance.
            assert.deepEqual(await page.$eval('.alumni-profile-view-button', button => {
                const style = getComputedStyle(button);
                return [style.paddingTop, style.paddingLeft, style.borderRadius, style.color];
            }), ['8px', '14px', '10px', 'rgb(31, 41, 55)']);
            await page.screenshot({ path: path.join(screenshots, 'desktop.png'), fullPage: true });
        });

        await t.test('only search/program/year controls remain and existing search/filter behavior is preserved', async () => {
            assert.deepEqual(await page.$$eval('.alumni-tracking-filters select', selects => selects.map(select => ({ label: select.getAttribute('aria-label'), placeholder: select.options[0].textContent }))), [
                { label: 'Filter by course', placeholder: 'All program' },
                { label: 'Filter by academic year', placeholder: 'Academic Year' }
            ]);
            assert.equal(await page.$$eval('.alumni-tracking-filters > *', controls => controls.length), 3);
            assert.deepEqual(await page.$$eval('select[aria-label="Filter by course"] option', options => options.map(option => option.value)), ['', 'BSBA', 'BSCRIM', 'BSIT']);
            await search('Marketing Management');
            await page.waitForFunction(() => document.querySelector('.alumni-tracking-table tbody strong')?.textContent === 'Foxtrot Missing');
            assert.equal((await rows())[0][3], 'Marketing Management');
            await search('Fixture Labs');
            await page.waitForFunction(() => document.querySelectorAll('.alumni-profile-view-button').length === 1);
            assert.match((await rows())[0][0], /^Alpha/);
            await search('no matching alumnus');
            await page.waitForSelector('.alumni-tracking-empty');
            assert.equal(await page.$eval('.alumni-tracking-empty', cell => cell.colSpan), 6);
            await search('');
            await select('Filter by course', 'BSCRIM');
            await page.waitForFunction(() => document.querySelectorAll('.alumni-profile-view-button').length === 1);
            assert.match((await rows())[0][0], /^Bravo/);
            await select('Filter by course', '');
            await select('Filter by academic year', '2023');
            await page.waitForFunction(() => document.querySelector('.alumni-tracking-table tbody strong')?.textContent === 'Foxtrot Missing');
            await select('Filter by academic year', '');
            // Employment data remains searchable after its dropdown is removed.
            await search('unemployed');
            await page.waitForFunction(() => document.querySelector('.alumni-tracking-table tbody strong')?.textContent === 'Charlie Rejected');
            assert.equal((await rows())[0][4], 'Rejected');
            await search('Developer');
            await page.waitForFunction(() => document.querySelectorAll('.alumni-profile-view-button').length === 11);
            await search('');
            await page.waitForFunction(() => document.querySelectorAll('.alumni-profile-view-button').length === 12);
        });

        await t.test('unchanged View Profile opens correct profiles and existing drawer tabs', async () => {
            for (const [index, id, name] of [[0, 1, 'Alpha Verified'], [1, 2, 'Bravo Pending']]) {
                const callsBefore = await page.evaluate(() => window.fixtureCalls.length);
                await page.$$eval('.alumni-profile-view-button', (buttons, index) => buttons[index].click(), index);
                await page.waitForSelector('.alumni-profile-drawer');
                assert.match(await page.$eval('.alumni-profile-drawer-content', content => content.textContent), /Loading permitted profile/);
                await page.waitForFunction(count => window.fixtureCalls.length > count, {}, callsBefore);
                assert.deepEqual(await page.evaluate(count => window.fixtureCalls.slice(count), callsBefore), [`/admin/alumni/users/${id}/tracking`]);
                await page.evaluate(() => window.releaseTracking());
                await page.waitForSelector('.alumni-profile-overview');
                assert.equal(await page.$eval('.alumni-profile-drawer h2', header => header.textContent), name);
                assert.match(await page.$eval('.alumni-profile-overview', panel => panel.textContent), /SpecializationNot recorded/);
                assert.doesNotMatch(await page.$eval('.alumni-profile-overview', panel => panel.textContent), /Marketing Management/);
                await clickText('.alumni-profile-tabs button', 'Employment History');
                await page.waitForFunction(() => !document.querySelector('.alumni-profile-overview'));
                assert.match(await page.$eval('.alumni-profile-drawer-content', content => content.textContent), id === 1 ? /Fixture Labs/ : /hidden by this alumnus/);
                await clickText('.alumni-profile-tabs button', 'Tracking Activity');
                await page.waitForSelector('.alumni-tracking-timeline');
                assert.match(await page.$eval('.alumni-tracking-timeline', timeline => timeline.textContent), /Account verification status changed/);
                await page.click('button[aria-label="Close profile"]');
                await page.waitForFunction(() => !document.querySelector('.alumni-profile-drawer'));
            }
            await page.focus('.alumni-tracking-table tbody tr:nth-child(3)');
            await page.keyboard.press('Enter');
            await page.waitForSelector('.alumni-profile-drawer');
            await page.evaluate(() => window.releaseTracking());
            await page.waitForSelector('.alumni-profile-overview');
            assert.equal(await page.$eval('.alumni-profile-drawer h2', header => header.textContent), 'Charlie Rejected');
            await page.$eval('.alumni-profile-drawer-backdrop', backdrop => backdrop.click());
            await page.waitForFunction(() => !document.querySelector('.alumni-profile-drawer'));
        });

        await t.test('remaining filters align responsively and mobile retains table scrolling', async () => {
            for (const width of [1440, 820, 390, 320]) {
                await page.setViewport({ width, height: 844 });
                const controls = await page.$$eval('.alumni-tracking-filters > *', controls => controls.map(control => {
                    const box = control.getBoundingClientRect();
                    return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, height: box.height };
                }));
                assert.equal(controls.length, 3);
                // Preserve the shared form controls' existing 44px minimum height.
                assert.ok(controls.every(control => control.left >= 0 && control.right <= width + 1 && control.height === 44), JSON.stringify({ width, controls }));
                for (let index = 1; index < controls.length; index++) {
                    if (width > 700) {
                        assert.ok(Math.abs(controls[index].top - controls[0].top) < 1);
                        assert.ok(Math.abs(controls[index].left - controls[index - 1].right - 10) < 1);
                    } else {
                        assert.ok(Math.abs(controls[index].left - controls[0].left) < 1);
                        assert.ok(Math.abs(controls[index].right - controls[0].right) < 1);
                        assert.ok(Math.abs(controls[index].top - controls[index - 1].bottom - 10) < 1);
                    }
                }
                if (width > 700) continue;
                const bounds = await page.$eval('.alumni-tracking-table-wrap', wrap => {
                    wrap.scrollLeft = wrap.scrollWidth;
                    const action = wrap.querySelector('.alumni-profile-view-button').getBoundingClientRect();
                    const box = wrap.getBoundingClientRect();
                    return { overflow: getComputedStyle(wrap).overflowX, scroll: wrap.scrollLeft, actionRight: action.right, right: box.right, viewport: innerWidth, columns: wrap.querySelectorAll('th').length };
                });
                assert.equal(bounds.overflow, 'auto');
                assert.equal(bounds.columns, 6);
                assert.ok(bounds.scroll > 0);
                assert.ok(bounds.actionRight <= bounds.right && bounds.right <= bounds.viewport + 1);
                await page.screenshot({ path: path.join(screenshots, `mobile-${width}.png`), fullPage: true });
            }
        });
        assert.deepEqual(errors, []);
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
});
