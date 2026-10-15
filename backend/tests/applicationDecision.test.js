const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../models');
const controller = require('../controllers/applicationController');
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
async function fixture(run) {
    const app = { id: 74, job_id: 34, recruitment_cycle: 2, alumni_id: 18, status: 'pending', is_archived: false, ApplicationDocuments: [{ id: 9, file_path: 'uploads/requirements/proof.pdf' }], async save() {} };
    const job = { id: 34, employer_id: 12, title: 'Office Assistant' };
    const notifications = [], audits = [];
    const overrides = [
        [db.sequelize, 'transaction', async fn => fn({ LOCK: { UPDATE: 'UPDATE' } })],
        [db.Job, 'findByPk', async () => job],
        [db.Application, 'findByPk', async () => app],
        [db.Application, 'max', async () => 2],
        [db.Application, 'findAll', async () => [app]],
        [db.Notification, 'create', async data => notifications.push(data)],
        [db.AuditLog, 'create', async data => audits.push(data)],
        [db.Interview, 'create', async () => { throw Error('Approval must not create an interview'); }]
    ];
    const originals = overrides.map(([target, key]) => target[key]);
    overrides.forEach(([target, key, value]) => { target[key] = value; });
    const decide = async (status, changes = {}) => {
        const req = { user: { id: 12, role: 'employer' }, params: { id: 74 }, body: { status, job_id: 34, recruitment_cycle: 2 }, ...changes };
        const res = response();
        await controller.reviewApplication(req, res, error => { res.statusCode = error.status || 500; res.body = { msg: error.message }; });
        return res;
    };
    try { await run({ app, job, notifications, audits, decide }); }
    finally { overrides.forEach(([target, key], i) => { target[key] = originals[i]; }); }
}
test.after(() => db.sequelize.close());
for (const user of [{ id: 12, role: 'employer' }, { id: 99, role: 'admin', admin_scope: 'employer' }]) {
    test(`${user.role} approves without interview details and repeated requests notify once`, () => fixture(async ({ app, notifications, audits, decide }) => {
        assert.equal((await decide('verified', { user })).statusCode, 200);
        assert.equal((await decide('verified', { user })).statusCode, 200);
        assert.equal(app.status, 'verified');
        assert.equal(app.is_archived, false);
        assert.equal(app.ApplicationDocuments[0].id, 9);
        assert.equal(notifications.length, 1);
        assert.match(notifications[0].message, /has been approved/);
        assert.doesNotMatch(notifications[0].message, /interview/i);
        assert.equal(audits.length, 1);
    }));
}
test('decline retains documents, hides active record, preserves alumni history, and is idempotent', () => fixture(async ({ app, notifications, decide }) => {
    assert.equal((await decide('not_verified')).statusCode, 200);
    assert.equal((await decide('not_verified')).statusCode, 200);
    assert.equal(app.status, 'not_verified');
    assert.equal(app.ApplicationDocuments.length, 1);
    assert.equal(notifications.length, 1);
    assert.match(notifications[0].message, /not selected/);
    const active = response();
    await controller.getJobApplicants({ user: { id: 12, role: 'employer' }, params: { jobId: 34 } }, active, error => { throw error; });
    assert.deepEqual(active.body, []);
    const history = response();
    await controller.getApplications({ user: { id: 18 } }, history, error => { throw error; });
    assert.equal(history.body[0].status, 'not_verified');
    assert.equal((await decide('verified')).statusCode, 409);
}));
test('wrong owner, wrong role, wrong job, old cycle and archived records cannot be decided', () => fixture(async ({ app, notifications, decide }) => {
    assert.equal((await decide('verified', { user: { id: 90, role: 'employer' } })).statusCode, 403);
    assert.equal((await decide('verified', { user: { id: 12, role: 'admin', admin_scope: 'alumni' } })).statusCode, 403);
    app.job_id = 77;
    assert.equal((await decide('verified')).statusCode, 409);
    app.job_id = 34; app.recruitment_cycle = 1;
    assert.equal((await decide('not_verified')).statusCode, 409);
    app.recruitment_cycle = 2; app.is_archived = true;
    assert.equal((await decide('verified')).statusCode, 409);
    assert.equal(app.status, 'pending');
    assert.equal(notifications.length, 0);
}));
test('admin route applicationId parameter is supported and context is mandatory', () => fixture(async ({ decide }) => {
    assert.equal((await decide('verified', { params: { applicationId: 74 } })).statusCode, 200);
    assert.equal((await decide('verified', { body: { status: 'verified' } })).statusCode, 400);
}));
