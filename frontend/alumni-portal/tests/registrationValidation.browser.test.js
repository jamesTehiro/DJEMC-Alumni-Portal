import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';

test('both routed registration forms validate before requests, retain documents, and work on desktop/mobile', async t => {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const tempRoot = path.resolve(root, '../../tmp');
    const directory = await mkdtemp(path.join(tempRoot, 'registration-validation-'));
    const document = path.join(directory, 'Registration proof.pdf');
    await writeFile(document, '%PDF-1.7\nRegistration fixture');
    let server, browser;
    try {
        const result = await build({
            stdin: { resolveDir: root, loader: 'jsx', contents: `
                import React from 'react'; import {createRoot} from 'react-dom/client';
                import {MemoryRouter, Routes, Route} from 'react-router-dom';
                import AlumniRegisterPage from './src/pages/AlumniRegisterPage';
                import EmployerRegisterPage from './src/pages/EmployerRegisterPage';
                import 'bootstrap/dist/css/bootstrap.min.css';
                window.registrationCalls=[];
                window.otpFixtureSessions=new Map();
                window.fixturePost=(url,payload)=>{
                    if(url.startsWith('/auth/registration-otp/')){
                        const row=window.otpFixtureSessions.get(payload.session_token)||{email:payload.email,verified:false};
                        if(url.endsWith('/verify'))row.verified=true;
                        window.otpFixtureSessions.set(payload.session_token,row);
                        return Promise.resolve({email:row.email,status:row.verified?'verified':'sent',verified:row.verified,
                            server_time:new Date().toISOString(),expires_at:new Date(Date.now()+300000).toISOString(),
                            verification_expires_at:new Date(Date.now()+600000).toISOString(),resend_at:new Date(Date.now()+60000).toISOString(),
                            attempts_remaining:5,resends_remaining:3,registration_authorization:row.verified?'fixture-authorization':undefined});
                    }
                    window.registrationCalls.push({url,fields:Array.from(payload.entries()).map(([name,value])=>[name,value instanceof File?{name:value.name,type:value.type,size:value.size}:value])});
                    return new Promise((resolve,reject)=>{window.acceptRegistration=()=>resolve({msg:'Existing success'});window.rejectRegistration=()=>reject(new Error('Existing server validation error'));});
                };
                createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={[location.pathname]}><Routes>
                    <Route path='/register' element={<AlumniRegisterPage/>}/>
                    <Route path='/register/employer' element={<EmployerRegisterPage/>}/>
                </Routes></MemoryRouter>);
            ` },
            bundle: true, write: false, outfile: 'registration-fixture.js', format: 'iife', platform: 'browser', jsx: 'automatic',
            define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"test"' },
            plugins: [{ name: 'registration-api-fixture', setup(builder) {
                builder.onResolve({ filter: /\/services\/api$/ }, () => ({ path: 'api', namespace: 'registration-fixture' }));
                builder.onLoad({ filter: /.*/, namespace: 'registration-fixture' }, () => ({ contents: 'export const api={post:(...args)=>window.fixturePost(...args)};' }));
            } }], logLevel: 'silent'
        });
        const js = result.outputFiles.find(file => file.path.endsWith('.js')).text;
        const css = result.outputFiles.find(file => file.path.endsWith('.css')).text;
        server = createServer((req, res) => {
            if (req.url === '/fixture.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(js); }
            if (req.url === '/fixture.css') { res.setHeader('Content-Type', 'text/css'); return res.end(css); }
            res.setHeader('Content-Type', 'text/html');
            res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body style="margin:0"><div id="root"></div><script src="/fixture.js"></script></body></html>');
        }).listen(0, '127.0.0.1');
        await new Promise(resolve => server.once('listening', resolve));
        browser = await puppeteer.launch({ headless: true, executablePath: process.env.PUPPETEER_EXECUTABLE_PATH });
        for (const employer of [false, true]) await t.test(employer ? 'employer registration' : 'alumni registration', async () => {
            const page = await browser.newPage();
            const errors = []; page.on('pageerror', error => errors.push(error.message));
            await page.setViewport({ width: 1280, height: 900 });
            const url = `http://127.0.0.1:${server.address().port}/register${employer ? '/employer' : ''}`;
            const put = (name, value) => page.$eval(`input[name="${name}"]`, (input, text) => {
                Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, text);
                input.dispatchEvent(new Event('input', { bubbles: true }));
            }, value);
            const submit = () => page.$eval('form', form => form.requestSubmit());
            const warning = async title => {
                await page.waitForFunction(expected => document.querySelector('.registration-validation-toast h2')?.textContent === expected, {}, title);
                assert.equal(await page.$$eval('.registration-validation-toast', nodes => nodes.length), 1);
                assert.equal(await page.evaluate(() => window.registrationCalls.length), 0);
            };
            const fields = () => page.evaluate(() => ({
                password: document.querySelector('[name="password"]').value,
                confirm: document.querySelector('[name="confirmPassword"]').value,
                files: document.querySelector('[name="companyAddress"]')
                    ? [...document.querySelectorAll('[aria-label="Selected business permit documents"] li span')].map(span => span.textContent)
                    : [...document.querySelectorAll('[aria-label="Selected proof of graduation documents"] li span')].map(span => span.textContent)
            }));
            try {
                await page.goto(url); await page.waitForSelector('input[name="confirmPassword"]');
                assert.equal(await page.$eval('[name="consent"]', input => input.checked), false);
                assert.equal(await page.$eval('[type="submit"]', button => button.disabled), false);
                await submit(); await warning('Required Information');
                await put('name', employer ? 'Fixture Company' : 'Fixture Alumni');
                await put('email', employer ? 'fixture@example.invalid' : 'fixture.validation@gmail.com');
                if (employer) await put('companyAddress', 'Fixture Address');
                else { await put('graduationYear', '2024'); await page.select('select[name="course"]', 'BSIT'); }
                await (await page.$('input[type="file"]')).uploadFile(document);
                if (employer) await page.waitForSelector('[aria-label="Selected business permit documents"] li');
                await submit(); await warning('Password Required');
                await put('password', 'Exact-Password-123');
                await submit(); await warning('Confirm Password Required');
                await put('confirmPassword', 'exact-Password-123');
                await submit(); await warning('Passwords Do Not Match');
                assert.equal(await page.$eval('.registration-validation-toast p', node => node.textContent), 'Your password and confirm password do not match. Please check and try again.');
                const preserved = await fields();
                assert.deepEqual(preserved.files, ['Registration proof.pdf']);
                await page.$eval('form', form => { for (let index = 0; index < 5; index++) form.requestSubmit(); });
                await warning('Passwords Do Not Match'); assert.deepEqual(await fields(), preserved);

                for (const name of ['password', 'confirmPassword']) {
                    await page.$eval(`[name="${name}"]`, input => input.parentElement.querySelector('button').click());
                    assert.equal(await page.$eval(`[name="${name}"]`, input => input.type), 'text');
                    await page.$eval(`[name="${name}"]`, input => input.parentElement.querySelector('button').click());
                    assert.equal(await page.$eval(`[name="${name}"]`, input => input.type), 'password');
                }
                await page.click('.registration-validation-toast [aria-label="Close notification"]');
                await page.waitForSelector('.registration-validation-toast', { hidden: true });
                await put('confirmPassword', 'Exact-Password-123'); await submit();
                await warning(employer ? 'Data Privacy Consent Required' : 'Privacy Consent Required');
                assert.equal(await page.$eval('.registration-validation-toast p', node => node.textContent), employer
                    ? 'Please review and accept the Data Privacy Consent before creating your employer account.'
                    : 'Please review and accept the Privacy Consent before creating your account.');

                for (const width of [1280, 375]) {
                    await page.setViewport({ width, height: 900 });
                    const layout = await page.evaluate(() => {
                        const password = document.querySelector('[name="password"]').getBoundingClientRect();
                        const confirm = document.querySelector('[name="confirmPassword"]').getBoundingClientRect();
                        const toast = document.querySelector('.registration-validation-toast').getBoundingClientRect();
                        return { width: innerWidth, scroll: document.documentElement.scrollWidth, passwordWidth: password.width, confirmWidth: confirm.width, passwordHeight: password.height, confirmHeight: confirm.height, toastLeft: toast.left, toastRight: toast.right, toastTop: toast.top };
                    });
                    assert.ok(layout.scroll <= layout.width + 1);
                    assert.ok(Math.abs(layout.passwordWidth - layout.confirmWidth) <= 1);
                    assert.equal(layout.passwordHeight, layout.confirmHeight);
                    assert.ok(layout.toastLeft >= 0 && layout.toastRight <= width + 1 && layout.toastTop < 160);
                }
                await page.waitForSelector('.registration-validation-toast', { hidden: true, timeout: 6500 });
                assert.equal((await fields()).files[0], 'Registration proof.pdf');
                const openPrivacy = () => page.click('.consent-row .highlight-link');
                await openPrivacy();
                await page.waitForSelector(employer ? '.consent-body' : '.modal.show');
                assert.equal(await page.$eval('[name="consent"]', input => input.checked), false);
                assert.equal(await page.evaluate(expected => document.body.textContent.includes(expected), employer ? 'Terms and Conditions' : 'Terms and Condition'), true);
                if (employer) {
                    await page.$eval('.consent-body', body => { body.scrollTop = body.scrollHeight; body.dispatchEvent(new Event('scroll', { bubbles: true })); });
                    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'I Understand & Agree' && !button.disabled));
                }
                await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'I Understand & Agree').click());
                await page.waitForSelector(employer ? '.consent-backdrop' : '.modal', { hidden: true });
                assert.equal(await page.$eval('[name="consent"]', input => input.checked), false);
                assert.equal(await page.$eval('[name="consent"]', input => input.disabled), false);
                await openPrivacy(); // An enabled checkbox must not toggle from label/link activation either.
                await page.waitForSelector(employer ? '.consent-body' : '.modal.show');
                assert.equal(await page.$eval('[name="consent"]', input => input.checked), false);
                if (employer) await page.evaluate(() => [...document.querySelectorAll('.consent-header button')].find(button => button.textContent.trim() === 'Close').click());
                else await page.click('.modal-header .btn-close');
                await page.waitForSelector(employer ? '.consent-backdrop' : '.modal', { hidden: true });
                await page.click('[name="consent"]');
                assert.equal(await page.$eval('[name="consent"]', input => input.checked), true);
                await page.$eval('form', form => { form.requestSubmit(); form.requestSubmit(); form.requestSubmit(); });
                if (!employer) {
                    await page.waitForFunction(() => !document.querySelector('input[aria-label="Digit 1 of 6"]')?.disabled);
                    await page.focus('input[aria-label="Digit 1 of 6"]');
                    await page.keyboard.type('123456');
                    await page.$eval('.registration-otp-modal form', form => form.requestSubmit());
                    await page.waitForFunction(() => document.body.textContent.includes('Gmail verified successfully'));
                    await page.click('.registration-otp-modal .modal-footer .primary-btn');
                }
                await page.waitForFunction(() => window.registrationCalls.length === 1);
                assert.equal(await page.$eval('[type="submit"]', button => button.disabled), true);
                const request = await page.evaluate(() => window.registrationCalls[0]);
                assert.equal(request.url, '/auth/register');
                const payload = Object.fromEntries(request.fields);
                assert.equal(payload.password, 'Exact-Password-123'); assert.equal(payload.role, employer ? 'employer' : 'alumni');
                assert.equal(payload.confirmPassword, undefined); assert.equal(payload.confirm_password, undefined);
                assert.equal(payload[employer ? 'business_permit' : 'proof_document'].name, 'Registration proof.pdf');
                if (!employer) assert.equal(payload.graduationYear, '2024');
                await page.evaluate(() => window.rejectRegistration());
                await page.waitForFunction(() => document.querySelector('.auth-error')?.textContent === 'Existing server validation error');
                assert.equal((await fields()).files[0], 'Registration proof.pdf');
                await submit(); await page.waitForFunction(() => window.registrationCalls.length === 2);
                await page.evaluate(() => window.acceptRegistration());
                await page.waitForFunction(() => [...document.querySelectorAll('.registration-success-toast h2')].some(title => /Successfully/.test(title.textContent)));
                await submit(); assert.equal(await page.evaluate(() => window.registrationCalls.length), 2);
                assert.deepEqual(errors, []);
            } finally { await page.close(); }
        });
    } finally {
        if (browser) await browser.close();
        if (server) await new Promise(resolve => server.close(resolve));
        assert.ok(path.resolve(directory).startsWith(tempRoot + path.sep));
        await rm(directory, { recursive: true, force: true });
    }
});
