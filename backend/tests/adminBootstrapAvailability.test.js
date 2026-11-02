const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'bootstrap-test-jwt-signing-secret';
const db = require('../models');
const { environment } = require('../config/adminOtpEnvironment');
const email = require('../utils/email');
const app = express();
app.use(express.json());
app.use('/api/auth', require('../routes/authRoutes'));
app.use((error, _req, res, _next) => res.status(error.status || 500).json({ code: error.code || 'TEST_ERROR' }));
const valid = { EMAIL_PROVIDER: 'brevo', BREVO_API_KEY: 'fixture-rest-key', EMAIL_FROM: 'sender@fixture.test',
    EMAIL_FROM_NAME: 'Fixture Portal', REGISTRATION_OTP_SECRET: 'a'.repeat(64), ADMIN_BOOTSTRAP_SECRET: 'fixture-bootstrap',
    DB_HOST: '127.0.0.1', DB_PORT: '1', DB_NAME: 'fixture', DB_USER: 'fixture' };
const allAdmins = ['registrar', 'alumni', 'employer'].map(admin_scope => ({ role: 'admin', admin_scope }));
const original = { source: environment.get, findAll: db.User.findAll, findOne: db.User.findOne,
    query: db.sequelize.query, destroy: db.RateLimitEntry.destroy, mail: email.validateConfiguration };
const saved = Object.fromEntries(Object.keys(valid).map(key => [key, process.env[key]]));
let server, base, admins;
test.before(async () => {
    environment.get = () => ({ ...process.env });
    db.User.findAll = async () => admins;
    db.User.findOne = async () => null;
    db.RateLimitEntry.destroy = async () => 0;
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}/api/auth`;
});
test.beforeEach(() => {
    Object.assign(process.env, valid);
    email.validateConfiguration = original.mail;
    admins = allAdmins.slice(0, 2);
    db.User.findAll = async () => admins;
    db.sequelize.query = async () => [[{ count: 1, expires_at: new Date(Date.now() + 60000) }]];
});
test.after(async () => {
    environment.get = original.source; db.User.findAll = original.findAll; db.User.findOne = original.findOne;
    db.sequelize.query = original.query; db.RateLimitEntry.destroy = original.destroy; email.validateConfiguration = original.mail;
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await db.sequelize.close();
});
async function request(path, body, secret) {
    const response = await fetch(base + path, { method: body ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json', ...(secret ? { 'x-bootstrap-secret': secret } : {}) },
        ...(body && { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json(), cache: response.headers.get('cache-control') };
}

test('three existing admins return successful registration-unavailable status without bootstrap, mail or OTP tables', async () => {
    admins = allAdmins;
    for (const key of ['ADMIN_BOOTSTRAP_SECRET', 'REGISTRATION_OTP_SECRET', 'BREVO_API_KEY', 'EMAIL_PROVIDER', 'EMAIL_FROM', 'EMAIL_FROM_NAME']) delete process.env[key];
    db.sequelize.query = async () => assert.fail('Read-only status must not access OTP/rate-limit tables');
    const result = await request('/admin-setup-status');
    assert.equal(result.status, 200); assert.equal(result.cache, 'no-store');
    assert.equal(result.body.registrationReason, 'ADMIN_LIMIT_REACHED');
    assert.equal(result.body.loginAvailable, true); assert.equal(result.body.registrationAvailable, false);
    assert.equal(result.body.adminCount, 3); assert.deepEqual(result.body.availableScopes, []);
    assert.equal(result.body.registrationConfigured, false);
});

test('status identifies missing bootstrap and each invalid OTP setting without exposing configuration values', async () => {
    for (const key of ['ADMIN_BOOTSTRAP_SECRET', 'REGISTRATION_OTP_SECRET', 'BREVO_API_KEY', 'EMAIL_PROVIDER', 'EMAIL_FROM', 'EMAIL_FROM_NAME']) {
        for (const value of ['', 'REPLACE_WITH_PRIVATE_VALUE']) {
            Object.assign(process.env, valid, { [key]: value });
            const result = await request('/admin-setup-status');
            assert.equal(result.status, 200); assert.equal(result.body.loginAvailable, true);
            assert.equal(result.body.registrationAvailable, false);
            assert.equal(result.body.registrationReason, key === 'ADMIN_BOOTSTRAP_SECRET' ? 'ADMIN_BOOTSTRAP_UNAVAILABLE' : 'ADMIN_OTP_UNAVAILABLE');
            assert.equal(JSON.stringify(result.body).includes('REPLACE_WITH_PRIVATE_VALUE'), false);
            for (const secret of [valid.ADMIN_BOOTSTRAP_SECRET, valid.BREVO_API_KEY, valid.REGISTRATION_OTP_SECRET]) assert.equal(JSON.stringify(result.body).includes(secret), false);
        }
    }
});

test('complete configuration enables registration only in an unoccupied scope', async () => {
    const result = await request('/admin-setup-status');
    assert.equal(result.status, 200); assert.equal(result.body.registrationAvailable, true);
    assert.equal(result.body.registrationReason, 'AVAILABLE'); assert.deepEqual(result.body.availableScopes, ['employer']);
    admins = allAdmins;
    const full = await request('/admin-setup-status');
    assert.equal(full.status, 200); assert.equal(full.body.registrationConfigured, true);
    assert.equal(full.body.registrationAvailable, false);
});

test('database outage is accurately reported without claiming login was checked', async () => {
    db.User.findAll = async () => { throw new Error('Private database details'); };
    const result = await request('/admin-setup-status');
    assert.equal(result.status, 503); assert.equal(result.body.code, 'ADMIN_STATUS_UNAVAILABLE');
    assert.equal(result.body.loginAvailable, null); assert.equal(result.body.registrationAvailable, false);
    assert.equal(JSON.stringify(result.body).includes('Private'), false);
});

test('full capacity rejects fourth creation and every admin OTP operation even with no bootstrap configuration', async () => {
    for (const scopes of [allAdmins, [allAdmins[0], allAdmins[1], { admin_scope: 'legacy' }]]) {
        admins = scopes; delete process.env.ADMIN_BOOTSTRAP_SECRET;
        for (const path of ['/admin-setup', ...['send', 'resend', 'verify', 'status'].map(op => `/admin-registration-otp/${op}`)]) {
            const result = await request(path, { email: 'fixture@gmail.com', admin_scope: 'employer' });
            assert.equal(result.status, 409); assert.equal(result.body.code, 'ADMIN_LIMIT_REACHED');
        }
    }
});

test('partial setup still requires configured and correct bootstrap secret', async () => {
    delete process.env.ADMIN_BOOTSTRAP_SECRET;
    const missing = await request('/admin-setup', {});
    assert.equal(missing.status, 503); assert.equal(missing.body.code, 'ADMIN_BOOTSTRAP_UNAVAILABLE');
    process.env.ADMIN_BOOTSTRAP_SECRET = valid.ADMIN_BOOTSTRAP_SECRET;
    const invalid = await request('/admin-setup', {}, 'wrong-fixture-secret');
    assert.equal(invalid.status, 403);
    const authorized = await request('/admin-setup', {}, valid.ADMIN_BOOTSTRAP_SECRET);
    assert.equal(authorized.status, 400); assert.equal(authorized.body.code, 'INVALID_ADMIN_REGISTRATION');
});

test('existing verified admin login/JWT remains usable without bootstrap or Brevo, for all three scopes', async () => {
    for (const mode of ['missing-bootstrap', 'missing-mail', 'provider-unavailable']) {
        Object.assign(process.env, valid);
        if (mode === 'missing-bootstrap') delete process.env.ADMIN_BOOTSTRAP_SECRET;
        if (mode === 'missing-mail') for (const key of ['REGISTRATION_OTP_SECRET', 'EMAIL_PROVIDER', 'BREVO_API_KEY', 'EMAIL_FROM', 'EMAIL_FROM_NAME']) delete process.env[key];
        // This represents a configured transport that is unavailable at runtime.
        email.validateConfiguration = () => { throw new Error('Mock Brevo unavailable'); };
        for (const { admin_scope } of allAdmins) {
            const user = { id: 801, email: 'fixture.admin@gmail.com', password: await bcrypt.hash('fixture-password', 4),
                role: 'admin', account_status: 'verified', admin_scope };
            db.User.findOne = async () => user;
            const result = await request('/login', { email: user.email, password: 'fixture-password' });
            assert.equal(result.status, 200);
            const claims = jwt.verify(result.body.token, process.env.JWT_SECRET, { issuer: 'alumni-portal' });
            assert.equal(claims.role, 'admin'); assert.equal(claims.admin_scope, admin_scope);
            assert.equal(result.body.user.password, undefined);
        }
    }
});
