"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const db = require("../models");
const controller = require("../controllers/jobController");
const notificationController = require("../controllers/notificationController");
const auditService = require("../services/auditService");
const { normalizePostingDetails, validateJobFields, salaryLabel } = require("../services/jobPosting");
const response = () => ({ statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
const posting = () => ({ work_setup: "hybrid", vacancy_count: 3, industry: "Education", company_description: "Company background", responsibilities: ["Manage records", "Coordinate schedules"], required_qualifications: { education: "Bachelor's degree", experience: "One year", skills: ["Communication"], other: [], preferred_start_date: "2026-12-01" }, preferred_qualifications: ["HR experience"], compensation: { min: 20000, max: 30000, period: "monthly", display: "range" }, benefits: { government: ["SSS"], additional: ["Training Opportunities"], other: [] }, application: { deadline: "2026-11-20", method: "portal", publish_contact: false, contact_email: "private@example.invalid", contact_number: "123", walk_in_address: "Private address", office_hours: "Private", instructions: "Submit the required documents" } });
const body = () => ({ title: "Records Assistant", description: "Organize department records", location: "San Jose", employment_type: "Full-Time", posting_details: posting(), requirements: [{ label: "Portfolio", is_custom: true, requirement_type: "document_upload", required: true }, { label: "Availability", is_custom: true, requirement_type: "information_field", value_type: "date", required: false }], groups: [], interview_details: { venue: "Main office", place: "San Jose", date: "2026-12-10", time: "09:30", contact_info: "interview@example.invalid", what_to_bring: "Portfolio" } });

async function withOverrides(overrides, run) {
    const originals = overrides.map(([target, values]) => [target, Object.fromEntries(Object.keys(values).map(key => [key, target[key]]))]);
    overrides.forEach(([target, values]) => Object.assign(target, values));
    try { await run(); } finally { originals.forEach(([target, values]) => Object.assign(target, values)); }
}
async function creation({ user = { id: 18, name: "DB Employer", role: "employer", account_status: "verified" }, input = body(), failRequirement = false } = {}, run) {
    const state = { jobs: [], requirements: [], notifications: [], committed: false, rolledBack: false };
    const transaction = { LOCK: { UPDATE: "UPDATE" } };
    await withOverrides([
        [db.sequelize, { transaction: async callback => { try { const result = await callback(transaction); state.committed = true; return result; } catch (error) { state.rolledBack = true; state.jobs = []; state.requirements = []; throw error; } } }],
        [db.User, { findByPk: async (id, options) => { assert.equal(Number(id), 18); assert.deepEqual(options.attributes, ["id", "name", "role", "admin_scope", "account_status"]); return user; }, findAll: async () => [{ id: 91 }] }],
        [db.EmployerProfile, { findOne: async () => ({ organization_name: "Registered Company" }) }],
        [db.Job, { create: async (payload, options) => { assert.equal(options.transaction, transaction); const job = { ...payload, id: 501 }; state.jobs.push(job); return job; }, findByPk: async () => state.jobs[0] }],
        [db.JobRequirement, { create: async (payload, options) => { assert.equal(options.transaction, transaction); if (failRequirement) throw new Error("Injected requirement failure"); state.requirements.push(payload); return payload; } }],
        [auditService, { log: async () => null }],
        [notificationController, { createNotification: async payload => { assert.equal(state.committed, true); state.notifications.push(payload); } }]
    ], async () => {
        const res = response();
        await controller.createJob({ user: { id: 18, role: "employer", name: "Untrusted token name" }, body: input, ip: "127.0.0.1" }, res);
        await run(res, state);
    });
}
test.after(() => db.sequelize.close());

test("both posting roles publish without salary or benefits and retain notifications", async () => {
    for (const role of ["employer", "admin"]) {
        const input = body();
        delete input.posting_details.compensation;
        delete input.posting_details.benefits;
        await creation({ user: { id: 18, name: "Verified poster", role, admin_scope: role === "admin" ? "employer" : null, account_status: "verified" }, input }, (res, state) => {
            assert.equal(res.statusCode, 200);
            assert.equal(state.jobs.length, 1);
            assert.ok(state.notifications.length > 0);
        });
    }
    const legacy = body(); delete legacy.posting_details; delete legacy.expected_salary;
    assert.equal(validateJobFields(legacy).expected_salary, "");
});

test("MariaDB JSON text reloads as an object and nullable older jobs remain readable", () => {
    const saved = normalizePostingDetails(posting());
    const job = db.Job.build({ posting_details: JSON.stringify(saved) });
    assert.deepEqual(job.posting_details, saved);
    assert.deepEqual(job.toJSON().posting_details, saved);
    assert.equal(db.Job.build({ posting_details: null }).posting_details, null);
    for (const value of ["not JSON", "null", "[]", '"scalar"']) assert.equal(db.Job.build({ posting_details: value }).posting_details, null);
});

test("structured posting normalization preserves all fields and requires explicit benefits", () => {
    const result = normalizePostingDetails(posting());
    assert.equal(result.work_setup, "hybrid"); assert.equal(result.vacancy_count, 3);
    assert.deepEqual(result.responsibilities, ["Manage records", "Coordinate schedules"]);
    assert.deepEqual(result.required_qualifications.skills, ["Communication"]);
    assert.deepEqual(result.benefits.government, ["SSS"]);
    const minimal = normalizePostingDetails({ work_setup: "remote" });
    assert.deepEqual(minimal.benefits, { government: [], additional: [], other: [] });
    assert.equal(minimal.vacancy_count, null);
});
test("unpublished contact information is cleared while application instructions remain", () => {
    const result = normalizePostingDetails(posting()).application;
    assert.equal(result.contact_email, ""); assert.equal(result.contact_number, "");
    assert.equal(result.walk_in_address, ""); assert.equal(result.office_hours, "");
    assert.equal(result.instructions, "Submit the required documents");
});
test("explicitly published contact details persist", () => {
    const input = posting(); input.application.publish_contact = true;
    const result = normalizePostingDetails(input).application;
    assert.equal(result.contact_email, "private@example.invalid");
    assert.equal(result.contact_number, "123"); assert.equal(result.walk_in_address, "Private address");
});
test("salary supports range, minimum, maximum, negotiable, and based on experience", () => {
    const input = posting();
    assert.equal(salaryLabel(normalizePostingDetails(input)), "PHP 20,000 – PHP 30,000 / monthly");
    input.compensation.max = null;
    assert.equal(salaryLabel(normalizePostingDetails(input)), "From PHP 20,000 / monthly");
    input.compensation.min = null; input.compensation.max = 25000;
    assert.equal(salaryLabel(normalizePostingDetails(input)), "Up to PHP 25,000 / monthly");
    input.compensation.display = "negotiable";
    assert.equal(salaryLabel(normalizePostingDetails(input)), "Negotiable");
    input.compensation.display = "based-on-experience";
    assert.equal(salaryLabel(normalizePostingDetails(input)), "Based on Experience");
});
test("invalid salary, vacancy, work setup, dates, application method and contact flags are rejected", () => {
    const changes = [p => { p.compensation.min = -1; }, p => { p.compensation.max = 1; }, p => { p.compensation.min = Infinity; }, p => { p.compensation.min = 1.123; }, p => { p.compensation.period = "yearly"; }, p => { p.compensation = { display: "range" }; }, p => { p.vacancy_count = 0; }, p => { p.vacancy_count = 2.5; }, p => { p.vacancy_count = 100001; }, p => { p.work_setup = "unknown"; }, p => { p.application.deadline = "2026-02-30"; }, p => { p.application.method = "external"; }, p => { p.application.publish_contact = "true"; }, p => { p.application.publish_contact = true; p.application.contact_email = "bad"; }];
    for (const change of changes) { const input = posting(); change(input); assert.throws(() => normalizePostingDetails(input), error => error.status === 400); }
});
test("malformed lists and dynamic requirements fail validation before persistence", () => {
    for (const mutate of [p => { p.responsibilities = "bad"; }, p => { p.required_qualifications.skills = [{}]; }, p => { p.benefits.government = ["Invented benefit"]; }]) { const input = posting(); mutate(input); assert.throws(() => normalizePostingDetails(input)); }
    for (const requirements of ["bad", [{ label: "" }], [{ label: "Test", requirement_type: "invalid" }], [{ label: "Test", required: "true" }]]) assert.throws(() => validateJobFields({ ...body(), requirements }));
});
test("legacy job fields remain compatible without structured details", () => {
    const input = { title: "Legacy", description: "Legacy description", location: "San Jose", expected_salary: "25000", course_target: "BSIT" };
    assert.deepEqual(validateJobFields(input), input);
    assert.deepEqual(validateJobFields({ title: " Updated " }, false), { title: "Updated" });
});
test("verified employer publishes one structured job with requirements, interview settings and alumni notification", async () => {
    const input = body(); input.employer_id = 777; input.company_name = "Impersonated Company";
    await creation({ input }, (res, state) => {
        assert.equal(res.statusCode, 200); assert.equal(state.jobs.length, 1); assert.equal(state.requirements.length, 2);
        assert.equal(state.jobs[0].employer_id, 18); assert.equal(state.jobs[0].company_name, undefined);
        assert.equal(state.jobs[0].posting_details.work_setup, "hybrid");
        assert.equal(state.jobs[0].expected_salary, "PHP 20,000 – PHP 30,000 / monthly");
        assert.equal(state.jobs[0].interview_contact_info, "interview@example.invalid");
        assert.equal(state.jobs[0].recruitment_status, undefined); // Existing model default stays active.
        assert.equal(state.notifications.length, 1); assert.deepEqual(state.notifications[0].userIds, [91]);
        assert.match(state.notifications[0].message, /Registered Company/);
        assert.equal(state.notifications[0].type, "job_posting");
    });
});
test("Employer Admin publishes through same API without employer profile verification or approval", async () => {
    await creation({ user: { id: 18, name: "Employer Admin", role: "admin", admin_scope: "employer", account_status: "verified" } }, (res, state) => {
        assert.equal(res.statusCode, 200); assert.equal(state.committed, true); assert.equal(state.jobs[0].employer_id, 18);
        assert.equal(state.notifications.length, 1);
    });
});
test("database role and account state deny forged, pending, suspended and other-scope users", async () => {
    for (const user of [null, { id: 18, role: "alumni", account_status: "verified" }, { id: 18, role: "employer", account_status: "pending" }, { id: 18, role: "employer", account_status: "suspended" }, { id: 18, role: "admin", admin_scope: "alumni", account_status: "verified" }, { id: 18, role: "admin", admin_scope: "employer", account_status: "suspended" }]) {
        await creation({ user }, (res, state) => { assert.equal(res.statusCode, 403); assert.equal(state.jobs.length, 0); assert.equal(state.notifications.length, 0); });
    }
});
test("legacy payload cannot bypass current database account authorization", async () => {
    const input = body(); delete input.posting_details; input.expected_salary = "25000";
    await creation({ input, user: { id: 18, role: "employer", account_status: "pending" } }, (res, state) => { assert.equal(res.statusCode, 403); assert.equal(state.jobs.length, 0); });
});
test("invalid required interview details and structured data never create jobs", async () => {
    for (const input of [{ ...body(), interview_details: {} }, { ...body(), posting_details: { work_setup: "invalid" } }]) await creation({ input }, (res, state) => { assert.equal(res.statusCode, 400); assert.equal(state.jobs.length, 0); assert.equal(state.notifications.length, 0); });
});
test("requirement storage failure rolls back job and sends no announcement", async () => {
    await creation({ failRequirement: true }, (res, state) => { assert.equal(res.statusCode, 500); assert.match(res.body.msg, /Injected requirement failure/); assert.equal(state.rolledBack, true); assert.equal(state.committed, false); assert.equal(state.jobs.length, 0); assert.equal(state.requirements.length, 0); assert.equal(state.notifications.length, 0); });
});
test("job update preserves ownership and updates selected structured data and location only", async () => {
    let saved; const job = { id: 501, employer_id: 18, current_requirement_version: 1 };
    const dbUser = { id: 18, role: "employer", account_status: "verified" };
    await withOverrides([
        [db.User, { findByPk: async () => dbUser }], [db.Job, { findByPk: async () => job, update: async (fields, options) => { saved = { fields, options }; } }],
        [db.sequelize, { transaction: async callback => callback({ LOCK: { UPDATE: "UPDATE" } }) }], [auditService, { log: async () => null }]
    ], async () => {
        const res = response(); await controller.updateJob({ user: { id: 18 }, params: { id: 501 }, body: { posting_details: posting(), location: "New Address", employer_id: 777 } }, res);
        assert.equal(res.statusCode, 200); assert.deepEqual(saved.options.where, { id: 501 });
        assert.equal(saved.fields.location, "New Address"); assert.equal(saved.fields.posting_details.work_setup, "hybrid"); assert.equal(saved.fields.employer_id, undefined);
    });
});
test("another employer cannot update a job", async () => {
    let updated = false;
    await withOverrides([[db.User, { findByPk: async () => ({ id: 18, role: "employer", account_status: "verified" }) }], [db.Job, { findByPk: async () => ({ id: 501, employer_id: 777 }), update: async () => { updated = true; } }]], async () => {
        const res = response(); await controller.updateJob({ user: { id: 18 }, params: { id: 501 }, body: { title: "Tampered" } }, res);
        assert.equal(res.statusCode, 403); assert.equal(updated, false);
    });
});
test("public job details exclude private account/profile/interview contact data", async () => {
    const raw = { id: 501, employer_id: 18, title: "Legacy", recruitment_status: "active", posting_details: null, interview_contact_info: "secret@example.invalid", interview_venue: "Private room", interview_place: "Private address", User: { id: 18, name: "Employer", email: "private@example.invalid", password: "secret", admin_avatar_url: "/avatar.png", EmployerProfile: { organization_name: "Registered Company", industry: "Education", logo_url: "/logo.png", contact_email: "private@example.invalid", address: "Private", business_permit_path: "Private" } } };
    await withOverrides([[db.Job, { findByPk: async () => ({ ...raw, toJSON: () => structuredClone(raw) }) }]], async () => {
        const res = response(); await controller.getJobById({ user: { id: 91, role: "alumni" }, params: { id: 501 } }, res);
        assert.equal(res.statusCode, 200); assert.equal(res.body.User.email, undefined); assert.equal(res.body.User.password, undefined);
        assert.equal(res.body.User.EmployerProfile.organization_name, "Registered Company"); assert.equal(res.body.User.EmployerProfile.contact_email, undefined);
        assert.equal(res.body.interview_contact_info, undefined); assert.equal(res.body.interview_venue, undefined); assert.equal(res.body.posting_details, null);
        const ownerRes = response(); await controller.getJobById({ user: { id: 18, role: "employer" }, params: { id: 501 } }, ownerRes);
        assert.equal(ownerRes.body.interview_contact_info, "secret@example.invalid");
    });
});

for (const user of [
    { id: 18, name: "Employer", role: "employer", account_status: "verified" },
    { id: 18, name: "Employer Admin", role: "admin", admin_scope: "employer", account_status: "verified" }
]) test(user.role + " publishes without interview configuration", async () => {
    const input = body(); delete input.interview_details;
    await creation({ user, input }, (res, state) => {
        assert.equal(res.statusCode, 200);
        assert.equal(state.jobs.length, 1);
        assert.equal(state.jobs[0].interview_venue, undefined);
        assert.equal(state.requirements.length, 2);
    });
});
