const test = require("node:test");
const assert = require("node:assert/strict");
const db = require("../models");
const { validateAlumniProfile, saveAlumniProfile } = require("../services/alumniProfileSave");

test.after(() => db.sequelize.close());
const userData = { id: 82, role: "alumni", account_status: "verified", name: "Example Alum", email: "example@example.invalid" };
async function fixture(run, failAt) {
    const state = { user: { ...userData }, profile: { id: 37, user_id: 82, employment_status: "employed", course: "BSIT", graduation_year: 2024, avatar_url: "/existing.png" }, membership: { id: 64, alumni_user_id: 82, application_status: "submitted", profile_completed_at: null }, history: [{ company_name: "Existing", position: "Existing", start_year: 2020 }], audits: [] };
    const transaction = { LOCK: { UPDATE: "UPDATE" } };
    const calls = [];
    const update = (key, values, options) => {
        assert.equal(options.transaction, transaction);
        calls.push(key);
        if (failAt === key) throw new Error("Injected storage failure");
        Object.assign(state[key], values);
    };
    const overrides = [
        [db.sequelize, "transaction", async callback => { const before = structuredClone(state); try { return await callback(transaction); } catch (error) { Object.assign(state, before); throw error; } }],
        [db.User, "findByPk", async (id, options) => { assert.equal(id, 82); assert.equal(options.transaction, transaction); return { ...state.user, update: async (values, opts) => update("user", values, opts), ...(options.include ? { AlumniProfile: { ...state.profile, EmploymentHistories: state.history } } : {}) }; }],
        [db.AlumniProfile, "findOrCreate", async options => { assert.equal(options.transaction, transaction); return [{ ...state.profile, update: async (values, opts) => update("profile", values, opts) }]; }],
        [db.MembershipApplication, "findOne", async options => { assert.equal(options.where.alumni_user_id, 82); assert.equal(options.where.application_status, "submitted"); assert.equal(options.transaction, transaction); if (!state.membership) return null; return { ...state.membership, update: async function (values, opts) { update("membership", values, opts); Object.assign(this, values); } }; }],
        [db.EmploymentHistory, "destroy", async options => { assert.equal(options.where.alumni_id, 37); assert.equal(options.transaction, transaction); state.history = []; }],
        [db.EmploymentHistory, "bulkCreate", async (items, options) => { assert.equal(options.transaction, transaction); if (failAt === "history") throw new Error("Injected storage failure"); state.history = items; }],
        [db.AuditLog, "create", async (value, options) => { assert.equal(options.transaction, transaction); if (failAt === "audit") throw new Error("Injected storage failure"); state.audits.push(value); }]
    ];
    const originals = overrides.map(([object, key]) => object[key]);
    overrides.forEach(([object, key, value]) => { object[key] = value; });
    try { await run(state, calls); } finally { overrides.forEach(([object, key], index) => { object[key] = originals[index]; }); }
}
const save = body => saveAlumniProfile({ user: userData, body, avatarPath: null, normalizeImagePath: value => value || null });

test("profile input is validated before any mutation", () => {
    for (const body of [{ email: "invalid" }, { name: "" }, { employment_status: "approved" }, { employment_history: "invalid" }, { employment_history: [{ company_name: {}, position: "B", start_year: 2020 }] }, { employment_history: [{ company_name: "A", position: "B", start_year: 2025, end_year: 2020 }] }]) assert.throws(() => validateAlumniProfile(body, userData), error => error.status === 400);
});
test("membership profile completion and profile data commit together", () => fixture(async state => {
    const result = await save({ name: "Updated Alum", phone: "123", membership_profile_completion: true, employment_history: [{ company_name: "New", position: "Engineer", start_year: 2024 }] });
    assert.equal(result.user.name, "Updated Alum");
    assert.equal(result.membership_profile_completed, true);
    assert.ok(state.membership.profile_completed_at instanceof Date);
    assert.equal(state.history[0].company_name, "New");
    assert.deepEqual(state.audits[0].metadata, { fields: ["profile_completed_at"] });
}));
test("partial profile save preserves unsubmitted academic/photo/career/history fields", () => fixture(async state => {
    await save({ phone: "456" });
    assert.equal(state.profile.course, "BSIT");
    assert.equal(state.profile.employment_status, "employed");
    assert.equal(state.profile.avatar_url, "/existing.png");
    assert.equal(state.history[0].company_name, "Existing");
    assert.equal(state.membership.profile_completed_at, null);
}));
test("completion cannot be recorded without a submitted membership application", () => fixture(async (state, calls) => {
    state.membership = null;
    await assert.rejects(save({ name: "Changed", membership_profile_completion: true }), error => error.status === 400);
    assert.deepEqual(calls, []);
    assert.equal(state.user.name, "Example Alum");
}));
test("completion cannot be recorded by a currently unverified account", () => fixture(async state => {
    state.user.account_status = "suspended";
    await assert.rejects(save({ membership_profile_completion: true }), error => error.status === 403);
    assert.equal(state.membership.profile_completed_at, null);
}));
for (const stage of ["profile", "history", "membership", "audit"]) test(`failure during ${stage} rolls back profile data and completion`, () => fixture(async state => {
    await assert.rejects(save({ name: "Changed", membership_profile_completion: true, employment_history: [{ company_name: "New", position: "New", start_year: 2023 }] }), /Injected storage failure/);
    assert.equal(state.user.name, "Example Alum");
    assert.equal(state.membership.profile_completed_at, null);
    assert.equal(state.history[0].company_name, "Existing");
}, stage));
test("a repeated profile save preserves the original completion timestamp", () => fixture(async state => {
    await save({ membership_profile_completion: true });
    const completed = state.membership.profile_completed_at;
    await save({ phone: "789", membership_profile_completion: true });
    assert.equal(state.membership.profile_completed_at, completed);
    assert.equal(state.audits.length, 1);
}));
