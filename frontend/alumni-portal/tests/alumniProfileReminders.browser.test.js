import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';

test('optional reminder uses existing notifications, persists dismissal, navigates to profile and preserves other notification actions', async () => {
    const result = await build({ stdin: { resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'jsx', contents: `
        import React from 'react';import {createRoot} from 'react-dom/client';
        import {MemoryRouter,Routes,Route,Link} from 'react-router-dom';
        import NotificationPage from './src/features/notifications/pages/NotificationPage';
        import {UndoDeleteProvider} from './src/contexts/UndoDeleteContext';
        import 'bootstrap/dist/css/bootstrap.min.css';
        const message='You may review and update your profile information whenever convenient to help keep your alumni records accurate and up to date. This reminder is optional.';
        window.rows=JSON.parse(localStorage.getItem('fixtureNotifications'))||[{id:1,type:'profile_update_reminder',message,isRead:false,createdAt:'2026-11-03T00:00:00Z'},
            {id:2,type:'warning',message:'Existing warning remains unchanged.',isRead:false,createdAt:'2026-11-02T00:00:00Z'},
            {id:3,type:'profile_update_request',message:'Existing manual profile request.',isRead:false,createdAt:'2026-11-01T00:00:00Z'}];
        window.requests=[];window.failDismiss=false;
        window.fixtureGet=async(path,auth)=>{window.requests.push(['GET',path,auth]);if(path!=='/notifications'||!auth)throw Error('Unexpected request');window.lastLoad=Date.now();return structuredClone(window.rows);};
        window.fixturePut=async(path,body,auth)=>{window.requests.push(['PUT',path,auth]);const row=window.rows.find(row=>path==='/notifications/read/'+row.id);if(!row||!auth)throw Error('Unexpected read');row.isRead=true;localStorage.setItem('fixtureNotifications',JSON.stringify(window.rows));return {};};
        window.fixtureDelete=async(path,auth)=>{window.requests.push(['DELETE',path,auth]);if(!auth)throw Error('Authentication required');if(window.failDismiss)throw Error('Unable to dismiss fixture reminder');window.rows=window.rows.filter(row=>path!=='/notifications/'+row.id);localStorage.setItem('fixtureNotifications',JSON.stringify(window.rows));return {};};
        createRoot(document.getElementById('root')).render(<UndoDeleteProvider><MemoryRouter initialEntries={['/notifications']}>
            <Routes><Route path='/notifications' element={<NotificationPage/>}/><Route path='/profile' element={<div>Own profile page<Link to='/notifications'>Back to notifications</Link></div>}/></Routes>
        </MemoryRouter></UndoDeleteProvider>);
    ` }, bundle: true, write: false, outdir: 'fixture', format: 'iife', platform: 'browser', jsx: 'automatic',
        define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"test"' },
        plugins: [{ name: 'fixture-api', setup(builder) {
            builder.onResolve({ filter: /\/services\/api$/ }, () => ({ path: 'api', namespace: 'fixture' }));
            builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `export const api={get:(...a)=>window.fixtureGet(...a),put:(...a)=>window.fixturePut(...a),delete:(...a)=>window.fixtureDelete(...a)};` }));
        } }], logLevel: 'silent'
    });
    const script = result.outputFiles.find(file => file.path.endsWith('.js')).text;
    const css = result.outputFiles.find(file => file.path.endsWith('.css')).text;
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
        await page.waitForSelector('.notification-reminder-title');
        assert.equal(await page.$eval('.notification-reminder-title', node => node.textContent), 'Profile Update Reminder');
        assert.match(await page.$eval('.notification-card', node => node.textContent), /This reminder is optional/);
        assert.equal(await page.$('.modal.show'), null);
        await page.setViewport({ width: 375, height: 812 });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Reminder fits mobile notification layout');
        await page.setViewport({ width: 1440, height: 1000 });
        await page.$$eval('button', nodes => nodes.find(node => node.textContent === 'View Profile').click());
        await page.waitForFunction(() => document.body.textContent.includes('Own profile page'));
        assert.ok(await page.evaluate(() => window.requests.some(([method,path,auth]) => method==='PUT'&&path==='/notifications/read/1'&&auth)));
        await page.waitForFunction(() => Date.now() - window.lastLoad > 1250);
        await page.click('a'); await page.waitForSelector('.notification-reminder-title');
        assert.match(await page.$eval('.notification-card', node => node.className), /read/);
        await page.evaluate(() => { window.failDismiss = true; });
        await page.$$eval('button', nodes => nodes.find(node => node.textContent === 'Dismiss').click());
        await page.waitForSelector('.notification-error');
        assert.ok(await page.$('.notification-reminder-title'), 'Failed dismissal does not hide an undismissed reminder');
        await page.evaluate(() => { window.failDismiss = false; });
        await page.$$eval('button', nodes => nodes.find(node => node.textContent === 'Dismiss').click());
        await page.waitForFunction(() => !document.querySelector('.notification-reminder-title'));
        assert.equal(await page.$('.notification-error'), null);
        await page.reload(); await page.waitForSelector('.notification-card');
        assert.equal(await page.$('.notification-reminder-title'), null, 'Dismissal remains absent after a new page load');
        assert.equal(await page.$eval('.notification-card', node => node.textContent.includes('Existing warning')), true);
        await page.$$eval('.notification-card:first-child button', nodes => nodes.find(node => node.textContent === 'Mark as Read').click());
        await page.waitForFunction(() => window.rows.find(row => row.id===2).isRead);
        assert.ok(await page.$$eval('button', nodes => nodes.some(node => node.textContent === 'Update Profile')), 'Manual requests retain existing action');
        await page.setViewport({ width: 375, height: 812 });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
        assert.deepEqual(errors, []);
    } finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
