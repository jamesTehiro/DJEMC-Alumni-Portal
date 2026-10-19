const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const db = require('../models');
const rateLimits = require('../utils/rateLimitStore');
const originalConsume = rateLimits.consumeRateLimit;
rateLimits.consumeRateLimit = async () => ({ allowed: true });
const auth = require('../controllers/authController');
rateLimits.consumeRateLimit = originalConsume;
const notification = require('../controllers/notificationController');
const admin = require('../controllers/adminController');
const registrar = require('../controllers/registrarController');
const announcements = require('../controllers/announcementController');
const audit = require('../services/auditService');
test.after(() => db.sequelize.close());
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

async function fixture(run) {
    const originals = [], rows = [], jobs = [], tokenRows = [];
    const change = (target, key, value) => { originals.push([target, key, target[key]]); target[key] = value; };
    const transaction = {};
    change(db.sequelize, 'transaction', async fn => fn(transaction));
    change(db.Notification, 'bulkCreate', async (values, options) => { assert.equal(options.transaction, transaction); rows.push(...values); return values; });
    change(db.EmailQueueJob, 'bulkCreate', async (values, options) => { jobs.push(...values); return values; });
    change(db.User, 'findAll', async () => [{ id: 7, email: 'alumnus@example.invalid' }]);
    change(db.PasswordResetToken, 'destroy', async () => {});
    change(db.PasswordResetToken, 'create', async values => { tokenRows.push(values); return values; });
    change(audit, 'log', async () => {});
    try { await run({ change, rows, jobs, tokenRows }); }
    finally { for (const [target, key, value] of originals.reverse()) target[key] = value; }
}

test('password resets queue the existing expiring reset link for matching alumni/employer only and keep generic responses', async () => {
    await fixture(async ({ change, jobs, tokenRows }) => {
        for (const role of ['alumni', 'employer']) {
            change(db.User, 'findOne', async ({ where }) => { assert.equal(where.role, role); return { id: 7, role, email: 'member@example.invalid' }; });
            const res = response();
            await auth.forgotPassword({ body: { role, email: 'member@example.invalid' }, headers: { origin: 'https://portal.example.invalid' }, ip: '127.0.0.1' }, res, error => { throw error; });
            assert.equal(res.body.msg, 'If an account exists, a reset link has been sent.');
            const job = jobs.at(-1), token = tokenRows.at(-1);
            assert.equal(job.to, 'member@example.invalid'); assert.equal(job.subject, 'Reset your password');
            const link = job.message.split('\n').find(line => line.includes('/reset-password?'));
            const raw = new URL(link.split('here: ').at(-1)).searchParams.get('token');
            assert.equal(crypto.createHash('sha256').update(raw).digest('hex'), token.token);
            assert.ok(token.expires_at > new Date());
            assert.match(job.message, /expires in 15 minutes/);
        }
        const count = jobs.length;
        change(db.User, 'findOne', async () => null);
        const missing = response();
        await auth.forgotPassword({ body: { role: 'alumni', email: 'absent@example.invalid' }, headers: {}, ip: '127.0.0.2' }, missing, error => { throw error; });
        assert.equal(jobs.length, count);
        assert.equal(missing.body.msg, 'If an account exists, a reset link has been sent.');
    });
});

test('registrar approval creates the existing alumni verification notification and queued email', async () => {
    await fixture(async ({ change, rows, jobs }) => {
        const user = { id: 7, role: 'alumni', account_status: 'pending', save: async () => {} };
        change(db.User, 'findByPk', async () => user);
        change(db.AlumniRecord, 'findByPk', async () => ({ id: 8 }));
        const res = response();
        await registrar.approveAlumniUser({ params: { id: 7 }, body: { alumni_record_id: 8 }, user: { id: 3, role: 'admin' } }, res);
        assert.equal(res.statusCode, 200); assert.equal(user.account_status, 'verified');
        assert.equal(rows[0].userId, 7); assert.match(rows[0].message, /verified as an alumnus/);
        assert.equal(jobs[0].subject, 'DJEMC Alumni Account Verified'); assert.equal(jobs[0].to, 'alumnus@example.invalid');
    });
});

test('admin warnings and employer job-review notifications retain role/recipient selection', async () => {
    await fixture(async ({ change, rows, jobs }) => {
        for (const role of ['alumni', 'employer']) {
            change(db.User, 'findByPk', async () => ({ id: 7, role }));
            const res = response();
            await admin[role === 'alumni' ? 'createAlumniWarning' : 'createEmployerWarning']({ body: { userId: 7, message: 'Existing warning' } }, res);
            assert.equal(res.statusCode, 200); assert.equal(rows.at(-1).type, 'warning');
            assert.equal(jobs.at(-1).subject, 'Admin Warning');
        }
        change(db.Job, 'findByPk', async () => ({ id: 91, employer_id: 7, title: 'Fixture job', save: async () => {} }));
        const res = response();
        await admin.updateJobApprovalStatus({ params: { jobId: 91 }, body: { approval_status: 'approved' }, user: { id: 3 } }, res);
        assert.equal(res.statusCode, 200); assert.equal(rows.at(-1).userId, 7);
        assert.equal(jobs.at(-1).subject, 'Job Post Review Update');
    });
});

test('both announcement paths preserve graduation-year range targeting through real notification enqueue', async () => {
    await fixture(async ({ change, rows, jobs }) => {
        const filters = [];
        change(db.Announcement, 'create', async values => ({ id: 1, ...values }));
        change(db.User, 'findAll', async options => {
            if (options.where.role === 'alumni') { filters.push(options); return [{ id: 7 }]; }
            return [{ id: 7, email: 'alumnus@example.invalid' }];
        });
        for (const handler of [announcements.createAnnouncement, admin.createAlumniAnnouncement]) {
            const res = response();
            await handler({ body: { title: 'Existing title', content: 'Existing content', target_year: '2023-2026' }, user: { id: 3 } }, res);
            assert.equal(res.statusCode, 200); assert.equal(rows.at(-1).userId, 7);
            assert.equal(jobs.at(-1).message, 'New announcement: Existing title');
        }
        assert.equal(filters.length, 2);
        for (const filter of filters) {
            const profileFilter = filter.include.find(include => include.model === db.AlumniProfile);
            assert.deepEqual(profileFilter.where.graduation_year[db.Sequelize.Op.between], [2023, 2026]);
        }
    });
});

test('notification API errors hide raw database details while retaining safe diagnostics', async () => {
    await fixture(async ({ change }) => {
        change(db.Notification, 'findAll', async () => { throw Object.assign(new Error('SQL private recipient and reset token'), { original: { code: 'ER_BAD_FIELD_ERROR' } }); });
        let logged = ''; const originalError = console.error;
        console.error = (...args) => { logged += JSON.stringify(args); };
        try {
            const res = response(); await notification.getUserNotifications({ user: { id: 7 } }, res);
            assert.equal(res.statusCode, 500); assert.doesNotMatch(res.body.msg, /SQL|private|token/);
            assert.match(logged, /ER_BAD_FIELD_ERROR/); assert.doesNotMatch(logged, /private|token/);
        } finally { console.error = originalError; }
    });
});
