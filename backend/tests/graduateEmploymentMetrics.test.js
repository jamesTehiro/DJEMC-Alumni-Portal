const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../models');
const admin = require('../controllers/adminController');
const profile = require('../controllers/profileController');
const { alumniProfileEmploymentMetrics, graduateEmploymentMetrics, normalizeEmploymentStatus } = require('../utils/graduateEmploymentMetrics');
const response = () => ({ statusCode: 200, headers: {}, setHeader(key, value) { this.headers[key] = value; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
const linked = (id, status, userId = id + 100) => ({ id, User: { id: userId, AlumniProfile: { employment_status: status } } });
test.after(() => db.sequelize.close());

test('only the three exact employment categories accept capitalization and separator formatting', () => {
    for (const [expected, values] of [
        ['employed', ['Employed', ' EMPLOYED ', 'employed']],
        ['unemployed', ['Unemployed', ' UNEMPLOYED ', 'unemployed']],
        ['self-employed', ['Self-Employed', 'self employed', 'SELF_EMPLOYED', ' Self – Employed ', 'Self‑Employed', 'SelfEmployed', 'Self---Employed']]
    ]) for (const value of values) assert.equal(normalizeEmploymentStatus(value), expected);
    for (const value of [null, undefined, '', ' ', 'unknown', 'retired', 'not employed', 'employed part time', 'unemployed/employed', 'constructor', {}, 1]) assert.equal(normalizeEmploymentStatus(value), null);
});

test('an account and official graduate cannot be counted twice or in two categories', () => {
    const records = [linked(1, 'employed', 10), linked(2, 'unemployed', 10), linked(1, 'self-employed', 11), linked(3, 'self-employed', 12)];
    assert.deepEqual(graduateEmploymentMetrics(records), { employed: 1, unemployed: 0, selfEmployed: 1 });
    assert.deepEqual(graduateEmploymentMetrics([linked(1, null, 10), linked(2, 'employed', 10)]), { employed: 0, unemployed: 0, selfEmployed: 0 });
});

test('alumni profile metrics normalize statuses and count each user only once', () => {
    const profiles = [
        { user_id: 10, employment_status: 'employed' },
        { user_id: 10, employment_status: 'self-employed' },
        { user_id: 11, employment_status: 'unemployed' },
        { user_id: 12, employment_status: 'Self Employed' },
        { user_id: 13, employment_status: 'Self-Employed' },
        { user_id: null, employment_status: 'employed' }
    ];
    assert.deepEqual(alumniProfileEmploymentMetrics(profiles), { employed: 1, unemployed: 1, selfEmployed: 2 });
});

test('missing statuses never fall back to account fields, company, history or unlinked profiles', () => {
    const records = [
        { id: 1, employment_status: 'employed', User: { id: 10, employment_status: 'employed', AlumniProfile: { current_company: 'Company', EmploymentHistories: [{ employment_status: 'employed' }] } } },
        { id: 2, User: null }, { id: 3, User: { id: 12, AlumniProfile: null } },
        { User: { id: 13, AlumniProfile: { employment_status: 'employed' } } }, linked(5, 'not specified')
    ];
    assert.deepEqual(graduateEmploymentMetrics(records), { employed: 0, unemployed: 0, selfEmployed: 0 });
});

test('the summary uses all alumni profiles for employment metrics and preserves the official total', async t => {
    const records = Array.from({ length: 31 }, (_, index) => ({ id: index + 1, User: null }));
    const profiles = [
        { user_id: 10, employment_status: 'Employed' },
        { user_id: 11, employment_status: 'UNEMPLOYED' },
        { user_id: 12, employment_status: ' Self – Employed ' },
        { user_id: 13, employment_status: 'Self Employed' },
        { user_id: 13, employment_status: 'employed' }
    ];
    t.mock.method(db.AlumniRecord, 'findAll', async options => {
        assert.deepEqual(options, {
            attributes: ['id'], include: [{ model: db.User, required: false, attributes: ['id'],
                include: [{ model: db.AlumniProfile, required: false, attributes: ['employment_status'] }] }]
        }, 'Total Graduates source, joins and filters must remain unchanged');
        return records;
    });
    t.mock.method(db.AlumniProfile, 'findAll', async options => {
        assert.deepEqual(options, { attributes: ['user_id', 'employment_status'], order: [['id', 'ASC']] });
        return profiles;
    });
    t.mock.method(db.User, 'findAll', async () => { throw Error('Do not replace the official master-list source'); });
    const result = response(); await admin.getAlumniTrackingSummary({}, result);
    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.body, { totalGraduates: 31, employed: 1, unemployed: 1, selfEmployed: 2 });
    assert.equal(result.headers['Cache-Control'], 'no-store');
    assert.equal(db.AlumniRecord.associations.User.foreignKey, 'alumni_record_id');
    assert.equal(db.User.associations.AlumniProfile.foreignKey, 'user_id');
    assert.equal(db.AlumniProfile.getTableName(), 'alumniprofiles');
});

test('saved Digital Resume profile updates refresh employment metrics while total remains unchanged', async t => {
    const alumniProfile = { id: 20, user_id: 12, employment_status: null, async update(values) { Object.assign(this, values); } };
    const user = { id: 12, role: 'alumni', name: 'Fixture Alumni', email: 'fixture@gmail.com', AlumniProfile: alumniProfile, async update(values) { Object.assign(this, values); } };
    const records = Array.from({ length: 31 }, (_, index) => ({ id: index + 1, User: index === 0 ? user : null }));
    t.mock.method(db.AlumniRecord, 'findAll', async () => records);
    t.mock.method(db.AlumniProfile, 'findAll', async () => [alumniProfile]);
    t.mock.method(db.User, 'findByPk', async () => user);
    t.mock.method(db.AlumniProfile, 'findOrCreate', async () => [alumniProfile]);
    t.mock.method(db.sequelize, 'transaction', async fn => fn({ LOCK: { UPDATE: 'UPDATE' } }));
    t.mock.method(db.AlumniProfileUpdateRequest, 'findAll', async () => []);
    t.mock.method(db.AuditLog, 'create', async () => ({}));
    for (const [status, expected] of [
        ['employed', [1, 0, 0]], ['unemployed', [0, 1, 0]], ['self-employed', [0, 0, 1]], [null, [0, 0, 0]]
    ]) {
        let error;
        const saved = response();
        await profile.updateProfile({ user: { id: 12 }, body: { employment_status: status }, files: {}, ip: '127.0.0.1' }, saved, failure => { error = failure; });
        assert.equal(error, undefined); assert.equal(saved.statusCode, 200);
        const preview = response(); await profile.getProfile({ user: { id: 12 } }, preview);
        assert.equal(preview.body.AlumniProfile.employment_status, status, 'the Digital Resume Preview reads the saved field');
        const summary = response(); await admin.getAlumniTrackingSummary({}, summary);
        assert.equal(summary.body.totalGraduates, 31);
        assert.deepEqual([summary.body.employed, summary.body.unemployed, summary.body.selfEmployed], expected);
    }
});
