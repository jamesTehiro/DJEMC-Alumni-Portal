const test = require("node:test");
const assert = require("node:assert/strict");

const db = require("../models");
const adminController = require("../controllers/adminController");
const profileController = require("../controllers/profileController");

const response = () => ({
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
});

const withOverrides = async (overrides, run) => {
    const originals = overrides.map(([target, values]) => [target, Object.fromEntries(Object.keys(values).map((key) => [key, target[key]]))]);
    for (const [target, values] of overrides) Object.assign(target, values);
    try { await run(); } finally { for (const [target, values] of originals) Object.assign(target, values); }
};

test.after(async () => { await db.sequelize.close(); });

test("admin profile update request creates one recipient notification and queues one email transactionally", async () => {
    const created = { id: 91, status: "pending", update: async function (values) { Object.assign(this, values); } };
    const createdNotifications = [];
    const queuedEmails = [];
    const transaction = { LOCK: { UPDATE: "UPDATE" } };
    await withOverrides([
        [db.sequelize, { transaction: async (callback) => callback(transaction) }],
        [db.User, { findOne: async () => ({ id: 12, role: "alumni", email: "alumni@example.invalid" }) }],
        [db.AlumniProfileUpdateRequest, { findOne: async () => null, create: async (values) => { Object.assign(created, values); return created; } }],
        [db.Notification, { create: async (values) => { createdNotifications.push(values); return { id: 44 }; } }],
        [db.EmailQueueJob, { create: async (values) => { queuedEmails.push(values); return { id: 55 }; } }],
        [db.AuditLog, { create: async () => ({ id: 66 }) }]
    ], async () => {
        const res = response();
        await adminController.requestAlumniProfileUpdate({ params: { userId: "12" }, user: { id: 5 }, ip: "127.0.0.1" }, res);
        assert.equal(res.statusCode, 201);
        assert.equal(res.body.request.status, "sent");
        assert.equal(res.body.email_status, "pending");
        assert.equal(createdNotifications.length, 1);
        assert.equal(createdNotifications[0].userId, 12);
        assert.equal(createdNotifications[0].type, "profile_update_request");
        assert.equal(queuedEmails.length, 1);
        assert.equal(queuedEmails[0].to, "alumni@example.invalid");
        assert.equal(queuedEmails[0].dedupe_key, "alumni-profile-update:91");
        const expectedMessage = "Hello, DJEMC Alumni!\n\nWould you like to update your educational background, employment status, or career progress? You may review and update your profile anytime through your Alumni Portal.\n\nThank you for staying connected with DJEMC!";
        assert.equal(created.request_message, expectedMessage);
        assert.equal(createdNotifications[0].message, expectedMessage);
        assert.equal(queuedEmails[0].message, expectedMessage);
        assert.equal(queuedEmails[0].subject, "Please Update Your DJEMC Alumni Profile");
    });
});

test("admin cannot create a duplicate active profile update request", async () => {
    const transaction = { LOCK: { UPDATE: "UPDATE" } };
    await withOverrides([
        [db.sequelize, { transaction: async (callback) => callback(transaction) }],
        [db.User, { findOne: async () => ({ id: 12, role: "alumni", email: "alumni@example.invalid" }) }],
        [db.AlumniProfileUpdateRequest, { findOne: async () => ({ id: 90, status: "sent" }), create: async () => { throw new Error("Should not create a second request."); } }]
    ], async () => {
        const res = response();
        await adminController.requestAlumniProfileUpdate({ params: { userId: "12" }, user: { id: 5 } }, res);
        assert.equal(res.statusCode, 409);
        assert.match(res.body.msg, /already active/i);
    });
});

test("admin tracking response hides employment details for a private alumni profile", async () => {
    const alumni = {
        id: 12, name: "Private Alum", role: "alumni", account_status: "verified",
        AlumniProfile: {
            profile_visibility: "private", employment_status: "employed", current_company: "Private Co", job_title: "Private Role",
            EmploymentHistories: [{ id: 1, company_name: "Private Co", position: "Private Role", start_year: 2020 }]
        },
        AlumniRecord: { full_name: "Private Alum", course: "BSIT", batch_year: 2020 }
    };
    await withOverrides([
        [db.User, { findOne: async () => alumni }],
        [db.AlumniProfileUpdateRequest, { findAll: async () => [] }],
        [db.AuditLog, { findAll: async () => [] }]
    ], async () => {
        const res = response();
        await adminController.getAlumniTrackingDetails({ params: { userId: "12" } }, res);
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.alumni.AlumniProfile.current_company, null);
        assert.equal(res.body.alumni.AlumniProfile.job_title, null);
        assert.deepEqual(res.body.alumni.AlumniProfile.EmploymentHistories, []);
    });
});

test("alumni profile save completes active profile update requests and records changed field names", async () => {
    const openRequest = { id: 93 };
    const updates = [];
    const audits = [];
    let userLookups = 0;
    const alumniProfile = { id: 31, user_id: 12, employment_status: "unemployed", current_company: null, job_title: null, update: async function (values) { Object.assign(this, values); } };
    const user = { id: 12, role: "alumni", name: "Alum", email: "alum@example.invalid", update: async function (values) { Object.assign(this, values); } };
    await withOverrides([
        [db.User, { findByPk: async () => (++userLookups === 1 ? user : { ...user, AlumniProfile: alumniProfile }) }],
        [db.AlumniProfile, { findOrCreate: async () => [alumniProfile] }],
        [db.AlumniProfileUpdateRequest, { findAll: async () => [openRequest], update: async (values, options) => { updates.push({ values, options }); } }],
        [db.sequelize, { transaction: async (callback) => callback({ LOCK: { UPDATE: "UPDATE" } }) }],
        [db.AuditLog, { create: async (values) => { audits.push(values); } }]
    ], async () => {
        const res = response();
        await profileController.updateProfile({
            user: { id: 12 }, body: { employment_status: "employed", current_company: "Example Ltd", job_title: "Analyst" }, files: {}, ip: "127.0.0.1"
        }, res, (err) => { throw err; });
        assert.equal(res.statusCode, 200);
        assert.equal(updates[0].values.status, "completed");
        assert.deepEqual(audits[0].metadata.fields, ["employment_status", "current_company", "job_title"]);
        assert.deepEqual(audits[0].metadata.completed_request_ids, [93]);
    });
});
