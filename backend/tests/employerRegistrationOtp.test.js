const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const db = require('../models');
Object.assign(process.env, { EMAIL_PROVIDER: 'brevo', BREVO_API_KEY: 'fixture-brevo-key', EMAIL_FROM: 'sender@fixture.test',
    EMAIL_FROM_NAME: 'Fixture Portal', REGISTRATION_OTP_SECRET: 's'.repeat(64), DB_HOST: '127.0.0.1', DB_PORT: '1', DB_NAME: 'fixture', DB_USER: 'fixture' });
delete process.env.ADMIN_BOOTSTRAP_SECRET;
let sequence = 123456;
const randomInt = crypto.randomInt; crypto.randomInt = () => sequence++;
const controller = require('../controllers/registrationOtpController');
const auth = require('../controllers/authController');
crypto.randomInt = randomInt;
const { processJob } = require('../workers/emailQueueWorker');
delete process.env.ADMIN_BOOTSTRAP_SECRET;
const { emailKey } = require('../utils/registrationEmail');
const { COOLDOWN } = require('../services/registrationOtp');
const otp = controller.employerOtp;
const recipient = 'fixture.employer@gmail.com', session = 'c'.repeat(64);
const original = { tx: db.sequelize.transaction, query: db.sequelize.query, userFind: db.User.findOne, userCreate: db.User.create,
    otpFind: db.RegistrationEmailVerification.findByPk, otpUpdate: db.RegistrationEmailVerification.update,
    bulk: db.EmailQueueJob.bulkCreate, jobFind: db.EmailQueueJob.findOne, jobUpdate: db.EmailQueueJob.update,
    profile: db.EmployerProfile.findOrCreate, fetch: global.fetch };
let rows, users, jobs, profiles, requests, queueFails, profileFails;
const attach = row => Object.defineProperty(row, 'update', { enumerable: false, value: async values => Object.assign(row, values) });
const same = (row, where) => Object.entries(where).every(([key, value]) => row[key] === value);
const row = () => rows.get(emailKey(recipient));
const code = () => jobs.at(-1).message.match(/^\d{6}$/m)[0];
const rejects = (promise, expected) => assert.rejects(promise, error => error.code === expected);
const response = () => ({ statusCode: 200, setHeader() {}, status(value) { this.statusCode = value; return this; }, json(body) { this.body = body; return this; } });
const body = () => ({ name: 'Fixture Company', email: recipient, password: 'fixture-password', role: 'employer',
    company_address: 'Fixture business address', website_url: 'https://fixture.test', session_token: session });
const files = () => ({ business_permit: [{ filename: 'fixture-permit.pdf', originalname: 'Permit.pdf', mimetype: 'application/pdf', size: 14,
    storageRef: '/uploads/business-permits/fixture-permit.pdf' }] });
async function register(values = body(), upload = files()) {
    const res = response(); let error;
    await auth.register({ body: values, files: upload }, res, failure => { error = failure; });
    return { res, error };
}
async function deliver(job = jobs.at(-1)) {
    Object.assign(job, { status: 'processing', attempts: 1, processing_started_at: new Date() });
    await processJob(job);
}
async function proof() {
    await otp.send(recipient, session); await deliver();
    return otp.verify(recipient, session, code());
}
test.beforeEach(() => {
    rows = new Map(); users = []; jobs = []; profiles = []; requests = []; queueFails = false; profileFails = false; sequence = 123456;
    db.User.findOne = async () => users[0] || null;
    db.User.create = async values => { const user = { ...values, id: users.length + 1 }; users.push(user); return user; };
    db.RegistrationEmailVerification.findByPk = async key => rows.get(key);
    db.RegistrationEmailVerification.update = async (values, { where }) => {
        const record = rows.get(where.email_key); if (!record || !same(record, where)) return [0];
        await record.update(values); return [1];
    };
    db.sequelize.query = async (_sql, { replacements: [key, to, hash] }) => {
        if (!rows.has(key)) rows.set(key, attach({ email_key: key, email: to, session_hash: hash, status: 'failed',
            sent_at: new Date(0), resend_history: [], failed_attempts: 0, consumed_at: null }));
    };
    db.sequelize.transaction = async callback => {
        const before = { rows: structuredClone([...rows]), users: structuredClone(users), jobs: structuredClone(jobs), profiles: structuredClone(profiles) };
        try { return await callback({ LOCK: { UPDATE: 'UPDATE' } }); }
        catch (error) {
            rows = new Map(before.rows.map(([key, record]) => [key, attach(record)])); users = before.users; jobs = before.jobs; profiles = before.profiles;
            throw error;
        }
    };
    db.EmailQueueJob.bulkCreate = async values => {
        if (queueFails) throw new Error('Mock queue failure');
        return values.map(value => { const job = { ...value, id: jobs.length + 1, max_attempts: 5 }; jobs.push(job); return job; });
    };
    db.EmailQueueJob.findOne = async ({ where }) => jobs.find(job => same(job, where));
    db.EmailQueueJob.update = async (values, { where }) => { const job = jobs.find(job => same(job, where)); if (!job) return [0]; Object.assign(job, values); return [1]; };
    db.EmployerProfile.findOrCreate = async ({ defaults, transaction }) => {
        assert.ok(transaction); if (profileFails) throw new Error('Mock permit persistence failure');
        const profile = attach({ ...defaults }); Object.defineProperty(profile, 'reload', { enumerable: false, value: async () => profile });
        profiles.push(profile); return [profile];
    };
    global.fetch = async (url, options) => {
        assert.equal(url, 'https://api.brevo.com/v3/smtp/email');
        requests.push(JSON.parse(options.body)); return Response.json({ messageId: '<fixture-employer-accepted>' }, { status: 201 });
    };
});
test.after(() => {
    db.sequelize.transaction = original.tx; db.sequelize.query = original.query;
    db.User.findOne = original.userFind; db.User.create = original.userCreate;
    db.RegistrationEmailVerification.findByPk = original.otpFind; db.RegistrationEmailVerification.update = original.otpUpdate;
    db.EmailQueueJob.bulkCreate = original.bulk; db.EmailQueueJob.findOne = original.jobFind; db.EmailQueueJob.update = original.jobUpdate;
    db.EmployerProfile.findOrCreate = original.profile; global.fetch = original.fetch;
    return db.sequelize.close();
});

test('new Gmail queues through existing worker/Brevo; acceptance precedes verification; account stays pending permit review', async () => {
    const sent = await otp.send(recipient, session);
    assert.equal(sent.email_status, 'pending'); assert.equal(requests.length, 0); assert.equal(users.length, 0);
    assert.ok(jobs[0].dedupe_key.length <= 191); assert.match(jobs[0].subject, /Employer Registration/);
    assert.equal(row().otp_hash.includes(code()), false);
    await rejects(otp.verify(recipient, session, code()), 'OTP_QUEUED');
    await deliver(); assert.equal(jobs[0].status, 'sent'); assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].to, [{ email: recipient }]); assert.match(requests[0].textContent, /valid for 5 minutes/);
    const verified = await otp.verify(recipient, session, code());
    const claims = jwt.verify(verified.registration_authorization, process.env.REGISTRATION_OTP_SECRET, { audience: 'employer-registration', issuer: 'alumni-portal' });
    assert.equal(claims.purpose, 'employer-registration');
    const { res, error } = await register({ ...body(), registration_authorization: verified.registration_authorization });
    assert.equal(error, undefined); assert.equal(res.statusCode, 201); assert.equal(users.length, 1);
    assert.equal(users[0].account_status, 'pending'); assert.ok(users[0].email_verified_at);
    assert.equal(profiles[0].verified, false); assert.equal(profiles[0].address, body().company_address);
    assert.equal(JSON.parse(profiles[0].business_permit_documents)[0].name, 'Permit.pdf');
    assert.equal(row().status, 'consumed'); assert.equal(row().consumed_by_user_id, users[0].id);
    await rejects(otp.consume(recipient, session, verified.registration_authorization, { LOCK: { UPDATE: 'UPDATE' } }), 'GMAIL_VERIFICATION_REQUIRED');
});

test('duplicate Gmail across all roles and review statuses blocks OTP without queueing or creating an account', async () => {
    for (const role of ['alumni', 'employer', 'admin']) for (const account_status of ['pending', 'verified', 'rejected']) {
        users = [{ role, account_status }];
        await rejects(otp.send(recipient, session), 'EMAIL_REGISTERED');
        assert.equal(jobs.length, 0); assert.equal(rows.size, 0);
    }
});

test('incorrect/expired codes, cooldown, attempt limit, resend replacement and worker expiry stay enforced', async () => {
    await otp.send(recipient, session); await deliver();
    await rejects(otp.send(recipient, session, { resend: true }), 'OTP_COOLDOWN');
    const first = code(); await rejects(otp.verify(recipient, session, '000000'), 'OTP_INCORRECT');
    row().expires_at = new Date(0); await rejects(otp.verify(recipient, session, first), 'OTP_EXPIRED');
    row().sent_at = new Date(Date.now() - COOLDOWN - 1000);
    await otp.send(recipient, session, { resend: true }); assert.notEqual(first, code());
    const old = jobs[0]; await deliver(old); assert.equal(old.status, 'failed');
    await deliver(); await rejects(otp.verify(recipient, session, first), 'OTP_INCORRECT');
    for (let i = 0; i < 4; i++) await rejects(otp.verify(recipient, session, '000000'), i === 3 ? 'OTP_ATTEMPTS' : 'OTP_INCORRECT');
    assert.equal(row().failed_attempts, 5);
});

test('no proof, another email/session and cross-purpose Alumni/Employer grants cannot authorize creation', async () => {
    const missing = await register(); assert.equal(missing.error.code, 'GMAIL_VERIFICATION_REQUIRED'); assert.equal(users.length, 0);
    const employer = await proof();
    const tx = { LOCK: { UPDATE: 'UPDATE' } };
    await rejects(controller.otp.consume(recipient, session, employer.registration_authorization, tx), 'GMAIL_VERIFICATION_REQUIRED');
    await rejects(otp.consume('different@gmail.com', session, employer.registration_authorization, tx), 'GMAIL_VERIFICATION_REQUIRED');
    await rejects(otp.consume(recipient, 'd'.repeat(64), employer.registration_authorization, tx), 'GMAIL_VERIFICATION_REQUIRED');
    const alumniToken = jwt.sign({ purpose: 'alumni-registration', email: recipient, session_hash: require('../services/registrationOtp').digest(session), verified_at: row().verified_at.getTime() }, process.env.REGISTRATION_OTP_SECRET, { audience: 'alumni-registration', issuer: 'alumni-portal', expiresIn: '10m' });
    const foreign = await register({ ...body(), registration_authorization: alumniToken });
    assert.equal(foreign.error.code, 'GMAIL_VERIFICATION_REQUIRED'); assert.equal(users.length, 0);
});

test('failed permit persistence rolls back account and grant consumption; permit remains required', async () => {
    const verified = await proof(); const values = { ...body(), registration_authorization: verified.registration_authorization };
    const absent = await register(values, {}); assert.equal(absent.res.statusCode, 400); assert.equal(users.length, 0);
    profileFails = true; const failed = await register(values); assert.ok(failed.error); assert.equal(users.length, 0); assert.equal(row().status, 'verified');
    profileFails = false; const success = await register(values); assert.equal(success.res.statusCode, 201);
});

test('queue/Brevo failure and expired jobs cannot report success or authorize accounts', async () => {
    queueFails = true; await rejects(otp.send(recipient, session), 'OTP_DELIVERY_FAILED'); assert.equal(jobs.length, 0);
    queueFails = false; row().sent_at = new Date(0);
    await otp.send(recipient, session);
    global.fetch = async () => Response.json({ message: 'Private provider details' }, { status: 401 });
    await deliver(); assert.equal(jobs[0].status, 'failed'); assert.equal((await otp.status(recipient, session)).email_status, 'failed');
    await rejects(otp.verify(recipient, session, code()), 'OTP_DELIVERY_FAILED');
    assert.equal(users.length, 0); assert.ok(!jobs[0].last_error.includes('Private'));
    row().sent_at = new Date(0); await otp.send(recipient, session);
    const queued = jobs.at(-1); row().expires_at = new Date(0); await deliver(queued); assert.equal(queued.status, 'failed');
    assert.equal(requests.length, 0);
});

test('Employer rejects placeholder settings and a worker with different sender settings without Admin bootstrap', async () => {
    for (const key of ['BREVO_API_KEY', 'REGISTRATION_OTP_SECRET']) {
        const value = process.env[key];
        try {
            process.env[key] = 'REPLACE_WITH_PRIVATE_RANDOM_MATERIAL_123456789';
            await rejects(otp.send(recipient, session), 'OTP_DELIVERY_FAILED');
            assert.equal(jobs.length, 0); row().sent_at = new Date(0);
        } finally { process.env[key] = value; }
    }
    await otp.send(recipient, session);
    const name = process.env.EMAIL_FROM_NAME;
    try {
        process.env.EMAIL_FROM_NAME = 'Different worker sender';
        await deliver(); assert.equal(jobs[0].status, 'failed'); assert.equal(requests.length, 0);
        assert.match(jobs[0].last_error, /CONFIG_MISMATCH/);
    } finally { process.env.EMAIL_FROM_NAME = name; }
    assert.equal(!!process.env.ADMIN_BOOTSTRAP_SECRET, false);
});
