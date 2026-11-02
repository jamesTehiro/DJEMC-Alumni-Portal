import test from 'node:test';
import assert from 'node:assert/strict';
import process from 'node:process';
import { preview } from 'vite';
import puppeteer from 'puppeteer';
import { fileURLToPath } from 'node:url';
let vite, browser, base;
const limit = 'Admin account limit reached. The portal already has all three authorized administrator accounts.';
test.before(async () => {
    vite = await preview({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error', preview: { host: '127.0.0.1', port: 0, strictPort: true } });
    base = `http://127.0.0.1:${vite.httpServer.address().port}`;
    browser = await puppeteer.launch({ executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, pipe: true });
});
test.after(async () => { await browser?.close(); if (vite) { vite.httpServer.closeAllConnections?.(); await new Promise(resolve => vite.httpServer.close(resolve)); } });
async function fixture({ full = false, path = '/admin', setupStatus = {}, availabilityFailure = false, loginSuccess = false } = {}) {
    const page = await browser.newPage();
    const state = { full, delivery: 'pending', verified: false, availabilityFailure, createFailure: false, createCalls: 0, requests: [], pageErrors: [],
        expiresAt: new Date(Date.now() + 300000).toISOString(), resendAt: new Date(Date.now() + 60000).toISOString() };
    // Successful login cases persist credentials by design. Each fixture starts
    // with its own empty local session so the next case does not auto-redirect.
    await page.evaluateOnNewDocument(origin => {
        if (window.location.origin === origin) { localStorage.clear(); sessionStorage.clear(); }
    }, base);
    page.on('pageerror', error => state.pageErrors.push(error.message));
    await page.setViewport({ width: path === '/admin/create' ? 390 : 1280, height: 950 });
    const view = () => ({ email: 'fixture.admin@gmail.com', status: state.verified ? 'verified' : 'sent', verified: state.verified, email_status: state.delivery,
        expires_at: state.expiresAt, server_time: new Date().toISOString(), resend_at: state.resendAt,
        attempts_remaining: 5, resends_remaining: 3, verification_expires_at: state.verified ? new Date(Date.now() + 600000).toISOString() : null,
        ...(state.verified ? { registration_authorization: 'fixture-admin-proof' } : {}) });
    await page.setRequestInterception(true);
    page.on('request', async request => {
        const url = new URL(request.url());
        if (url.origin === base) return request.continue();
        if (!url.pathname.startsWith('/api/')) return request.abort();
        const payload = request.postData() ? JSON.parse(request.postData()) : {};
        state.requests.push({ path: url.pathname, method: request.method(), payload, headers: request.headers() });
        const reply = (body, status = 200) => request.respond({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' }, body: JSON.stringify(body) });
        if (request.method() === 'OPTIONS') return reply({}, 204);
        if (url.pathname.endsWith('/admin-setup-status')) {
            if (state.availabilityFailure) return reply(state.availabilityFailure === 'bootstrap' ? { msg: 'Admin bootstrap is not configured.' } : { code: 'ADMIN_STATUS_UNAVAILABLE', msg: 'Server temporarily unavailable.' }, 503);
            return reply({ adminCount: state.full ? 3 : 2, setupComplete: state.full, registrarAdminExists: true, employerAdminExists: true, alumniAdminExists: state.full, availableScopes: state.full ? [] : ['alumni'], registrationConfigured: true, ...setupStatus });
        }
        if (url.pathname.includes('/admin-registration-otp/')) {
            if (request.headers()['x-bootstrap-secret'] !== 'fixture-setup-secret') return reply({ code: 'INVALID_BOOTSTRAP_SECRET', msg: 'Invalid bootstrap secret.' }, 403);
            if (url.pathname.endsWith('/send') || url.pathname.endsWith('/resend')) { assert.equal(payload.name, 'Fixture admin'); assert.equal(payload.password, 'fixture-password'); }
            else { assert.equal('password' in payload, false); assert.equal('name' in payload, false); }
            if (url.pathname.endsWith('/verify')) {
                if (payload.otp !== '123456') return reply({ msg: 'Incorrect code. 4 attempts remaining.', code: 'OTP_INCORRECT' }, 400);
                state.verified = true;
            }
            return reply(view());
        }
        if (url.pathname.endsWith('/admin-setup')) {
            state.createCalls++;
            assert.equal(payload.registration_authorization, 'fixture-admin-proof');
            assert.equal(payload.admin_scope, 'alumni');
            assert.equal('bootstrap_secret' in payload, false);
            await new Promise(resolve => setTimeout(resolve, 150));
            if (state.createFailure) { state.full = true; return reply({ msg: limit, code: 'ADMIN_LIMIT_REACHED' }, 409); }
            state.full = true; return reply({ msg: 'Admin created.' }, 201);
        }
        if (url.pathname.endsWith('/login')) return loginSuccess
            ? reply({ token: 'fixture-login-token', user: { id: 801, role: 'admin', admin_scope: 'employer', account_status: 'verified', name: 'Fixture admin' } })
            : reply({ msg: 'Invalid credentials' }, 401);
        return reply({ msg: 'Unexpected fixture request.' }, 404);
    });
    await page.goto(base + path);
    await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Admin Portal');
    return { page, state };
}
const clickText = async (page, label) => {
    await page.waitForFunction(text => [...document.querySelectorAll('button')].some(node => node.textContent.trim() === text && !node.disabled), {}, label);
    assert.equal(await page.evaluate(text => { const button = [...document.querySelectorAll('button')].find(node => node.textContent.trim() === text && !node.disabled); button?.click(); return !!button; }, label), true, `Enabled button exists: ${label}`);
};
async function fill(page, secret = 'fixture-setup-secret') {
    for (const [name, value] of Object.entries({ bootstrap_secret: secret, name: 'Fixture admin', email: 'fixture.admin@gmail.com', password: 'fixture-password', confirmPassword: 'fixture-password' })) await page.type(`input[name="${name}"]`, value);
}
async function verify(page, state) {
    await clickText(page, 'Verify Gmail to create account');
    await page.waitForFunction(() => document.querySelector('.modal-body')?.textContent.includes('queued for delivery'));
    assert.equal(await page.$eval('.modal form button', node => node.disabled), true);
    state.delivery = 'sent';
    await page.waitForFunction(() => document.querySelector('.modal-body')?.textContent.includes('OTP sent successfully'));
    await page.waitForFunction(() => document.querySelector('input[aria-label="Digit 1 of 6"]')?.disabled === false);
    await page.type('input[aria-label="Digit 1 of 6"]', '999999'); await clickText(page, 'Verify Gmail');
    await page.waitForFunction(() => document.querySelector('.modal-body')?.textContent.includes('Incorrect code'));
    assert.equal(await page.$('.modal-footer'), null);
    await page.waitForFunction(() => document.querySelector('input[aria-label="Digit 1 of 6"]')?.disabled === false);
    await page.$eval('input[aria-label="Digit 1 of 6"]', node => node.focus());
    await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
    await page.type('input[aria-label="Digit 1 of 6"]', '123456'); await clickText(page, 'Verify Gmail');
    await page.waitForSelector('.modal-footer button');
}
test('three existing admins hide creation; login displays HTTP authentication failures', async () => {
    const { page, state } = await fixture({ full: true });
    try {
        await page.waitForFunction(text => document.body.textContent.includes(text), {}, limit);
        assert.equal(await page.$('input[name="bootstrap_secret"]'), null);
        assert.equal(await page.evaluate(() => [...document.querySelectorAll('button')].some(node => node.textContent.trim() === 'Create account')), false);
        await page.type('input[name="email"]', 'admin@example.invalid'); await page.type('input[name="password"]', 'wrong-password');
        await page.$eval('form', node => node.requestSubmit());
        await page.waitForFunction(() => document.querySelector('[role="alert"]')?.textContent.includes('Invalid credentials'));
        assert.equal(await page.evaluate(() => localStorage.getItem('token')), null);
        assert.deepEqual(state.pageErrors, []);
    } finally { await page.close(); }
});

test('registration configuration failures never disable existing admin login', async () => {
    const cases = [
        { availabilityFailure: 'bootstrap', expected: 'bootstrap secret' },
        { setupStatus: { registrationAvailable: false, registrationConfigured: false, registrationReason: 'ADMIN_BOOTSTRAP_UNAVAILABLE' }, expected: 'bootstrap secret' },
        { setupStatus: { registrationAvailable: false, registrationConfigured: false, registrationReason: 'ADMIN_OTP_UNAVAILABLE' }, expected: 'OTP email configuration' },
        { full: true, setupStatus: { registrationAvailable: false, registrationConfigured: false, registrationReason: 'ADMIN_LIMIT_REACHED' }, expected: 'all three authorized administrator accounts' },
        { setupStatus: { registrationAvailable: false, registrationConfigured: false, registrationReason: 'ADMIN_REGISTRATION_UNAVAILABLE' }, expected: 'registration is temporarily unavailable' },
        { availabilityFailure: true, expected: 'backend may be temporarily unavailable' }
    ];
    for (const scenario of cases) {
        const { page, state } = await fixture({ ...scenario, loginSuccess: true });
        try {
            await page.waitForFunction(text => document.querySelector('[aria-label="Admin registration availability"]')?.textContent.includes(text), {}, scenario.expected);
            assert.equal(await page.$('input[name="bootstrap_secret"]'), null);
            assert.equal(await page.$eval('input[name="email"]', node => node.disabled), false);
            assert.equal(await page.$eval('form button[type="submit"]', node => node.disabled), false);
            assert.equal(await page.$('.auth-error'), null, 'A registration notice must not look like a login error');
            if (scenario.availabilityFailure === 'bootstrap') await page.screenshot({ path: fileURLToPath(new URL('../../../tmp/admin-bootstrap-login.png', import.meta.url)) });
            await page.type('input[name="email"]', 'fixture.admin@gmail.com');
            await page.type('input[name="password"]', 'fixture-password');
            await page.$eval('form', node => node.requestSubmit());
            await page.waitForFunction(() => localStorage.getItem('token') === 'fixture-login-token');
            assert.equal(state.requests.filter(request => request.path.endsWith('/login') && request.method === 'POST').length, 1);
            assert.equal(state.requests.some(request => request.path.includes('admin-registration-otp')), false);
            assert.equal(state.requests.some(request => request.path.endsWith('/admin-setup')), false);
        } finally { await page.close(); }
    }
});
test('admin form handles bad secret, queued mail, invalid OTP, successful verification and duplicate submissions', async () => {
    const { page, state } = await fixture();
    try {
        await page.waitForFunction(() => [...document.querySelectorAll('button')].some(node => node.textContent.trim() === 'Create account'));
        await clickText(page, 'Create account'); await fill(page, 'invalid-secret');
        assert.deepEqual(await page.$$eval('select option:disabled', nodes => nodes.map(node => node.value).sort()), ['employer', 'registrar']);
        await clickText(page, 'Verify Gmail to create account');
        await page.waitForFunction(() => document.querySelector('.modal-body')?.textContent.includes('Invalid bootstrap secret.'));
        assert.equal(await page.$('.modal-footer'), null);
        await page.waitForSelector('.modal-header .btn-close', { visible: true });
        await page.click('.modal-header .btn-close'); await page.waitForFunction(() => !document.querySelector('.modal'));
        await page.$eval('input[name="bootstrap_secret"]', node => node.focus()); await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control'); await page.type('input[name="bootstrap_secret"]', 'fixture-setup-secret');
        await verify(page, state);
        assert.equal(state.createCalls, 0);
        assert.equal(await page.$eval('fieldset.registration-fields', node => node.disabled), true);
        assert.equal(await page.evaluate(() => JSON.stringify({ ...sessionStorage, ...localStorage }).includes('fixture-setup-secret')), false);
        await page.screenshot({ path: fileURLToPath(new URL('../../../tmp/admin-otp-desktop.png', import.meta.url)) });
        await page.$eval('.modal-footer button', node => { node.click(); node.click(); });
        await page.waitForFunction(() => document.body.textContent.includes('Admin account created. Please sign in.'));
        assert.equal(state.createCalls, 1); assert.deepEqual(state.pageErrors, []);
        assert.equal(await page.evaluate(() => sessionStorage.getItem('djemc-admin-registration-gmail-session')), null);
        assert.equal(await page.$('input[name="bootstrap_secret"]'), null);
    } finally { await page.close(); }
});
test('legacy create URL shares verification; a backend limit conflict never displays success', async () => {
    const { page, state } = await fixture({ path: '/admin/create' });
    try {
        await page.waitForSelector('input[name="bootstrap_secret"]'); await fill(page); await verify(page, state);
        await page.screenshot({ path: fileURLToPath(new URL('../../../tmp/admin-otp-mobile.png', import.meta.url)) });
        state.createFailure = true; await page.click('.modal-footer button');
        await page.waitForFunction(() => document.querySelector('[role="alert"]')?.textContent.includes('Admin account limit reached.'));
        assert.equal(await page.$('.auth-success'), null); assert.equal(state.createCalls, 1); assert.deepEqual(state.pageErrors, []);
    } finally { await page.close(); }
});

test('Admin uses registration validation notices and sends no OTP before password confirmation matches', async () => {
    const { page, state } = await fixture({ path: '/admin/create' });
    try {
        await page.waitForSelector('input[name="bootstrap_secret"]');
        await fill(page);
        await page.$eval('input[name="confirmPassword"]', node => node.focus());
        await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
        await page.type('input[name="confirmPassword"]','different-password');
        await clickText(page,'Verify Gmail to create account');
        await page.waitForFunction(() => document.body.textContent.includes('Passwords Do Not Match'));
        assert.equal(state.requests.filter(request => request.path.includes('admin-registration-otp')).length,0);
        assert.equal(await page.$('.modal'),null);
        assert.equal(state.createCalls,0);
        assert.deepEqual(state.pageErrors,[]);
    } finally { await page.close(); }
});
