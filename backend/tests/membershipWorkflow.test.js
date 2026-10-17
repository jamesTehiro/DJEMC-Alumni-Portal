"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const db = require("../models");
const controller = require("../controllers/membershipController");
const validation = require("../services/membershipValidation");
const pdf = require("../services/resumePdf");

const response = () => ({ statusCode: 200, headers: {}, status(code) { this.statusCode = code; return this; }, json(value) { this.body = JSON.parse(JSON.stringify(value)); return this; }, setHeader(key, value) { this.headers[key] = value; }, send(value) { this.body = value; return this; } });
const request = (body = {}, id = 7) => ({ user: { id, role: "alumni" }, body, query: {}, params: {}, ip: "127.0.0.1" });
const complete = () => ({
    personal_details: { first_name: "Alex", last_name: "Graduate", email: "alex@example.com", contact_number: "09123456789", social_media_account: "@alex", tin: "Private TIN", religion: "Private Religion" },
    educational_attainment: [{ level: "Bachelor's", school_name: "DJEMC", program: "BSIT", year_graduated: "2026", competency: "Software" }],
    work_experience: [{ employment_period: "2025 - Present", agency_employer: "Office", position: "Engineer", employment_status: "Regular" }],
    training_seminars: [{ title: "Safety", date: "2026-01-01", venue: "Campus", facilitator: "Association" }],
    community_involvement: [{ date: "2026", organization: "Community", designation: "Volunteer", years: "1" }],
    awards_citations: [{ award: "Service", date: "2026-02-02", venue: "Campus", awarding_body: "DJEMC" }],
    options: {}, consent_accepted: true
});

async function fixture(run, settings = {}) {
    let state = { applications: [], audits: [] };
    const calls = { commits: 0, rollbacks: 0, pdf: 0, lists: [] };
    const backups = [];
    const override = (target, changes) => { backups.push([target, Object.fromEntries(Object.keys(changes).map(key => [key, target[key]]))]); Object.assign(target, changes); };
    const matches = (row, where) => Object.entries(where || {}).every(([key, value]) => value && typeof value === "object" && value[db.Sequelize.Op.in] ? value[db.Sequelize.Op.in].includes(row[key]) : String(row[key]) === String(value));
    const row = data => ({ ...data, toJSON: () => ({ ...data }), update: async (fields, options) => { assert.ok(options.transaction); Object.assign(data, fields); return row(data); } });
    override(db.User, { findByPk: async (id, options) => {
        assert.ok(!options.attributes.includes("password"));
        if (settings.missingUser) return null;
        return { id: Number(id), role: settings.role || "alumni", admin_scope: settings.scope || "alumni", account_status: settings.status || "verified", name: "Alex Graduate", email: "registered@example.com", alumni_record_id: 8 };
    } });
    override(db.AlumniProfile, { findOne: async options => { assert.ok(options.where.user_id); return { id: 10, phone: "09123456789", address: "Profile City", course: "Old program", graduation_year: 2025, job_title: "Engineer", current_company: "Office", avatar_url: settings.avatarUrl || null }; } });
    override(db.AlumniRecord, { findByPk: async () => ({ id: 8, course: "Verified BSIT", batch_year: 2026 }) });
    override(db.EmploymentHistory, { findAll: async options => { assert.equal(options.where.alumni_id, 10); return [{ company_name: "Office", position: "Engineer", start_year: 2025, end_year: null, employment_type: "Full-time" }]; } });
    override(db.MembershipAdministrator, { findOne: async options => { assert.equal(options.where.revoked_at, null); return settings.grant ? { id: 1 } : null; } });
    override(db.MembershipApplication, {
        findOne: async options => { if (settings.schemaMissing) throw Object.assign(new Error("Private database statement"), { original: { code: "ER_NO_SUCH_TABLE" } }); const found = state.applications.find(data => matches(data, options.where)); return found ? row(found) : null; },
        create: async (fields, options) => { assert.ok(options.transaction); if (settings.failSave) throw new Error("Private SQL with sensitive values"); const data = { id: state.applications.length + 1, consent_accepted: false, profile_completed_at: null, ...fields }; state.applications.push(data); return row(data); },
        findAndCountAll: async options => { calls.lists.push(options); const records = state.applications.filter(data => ["submitted", "pending_review", "approved", "for_correction"].includes(data.application_status)); return { count: records.length, rows: records.slice(options.offset, options.offset + options.limit).map(data => row(Object.fromEntries(options.attributes.map(key => Array.isArray(key) ? [key[1], data.personal_details?.email || ""] : [key, data[key]])))) }; },
        findAll: async options => {
            const records = state.applications.filter(data => ["submitted", "pending_review", "approved", "for_correction"].includes(data.application_status));
            if (options.group.includes("application_status")) return Object.entries(records.reduce((totals, record) => ({ ...totals, [record.application_status]: (totals[record.application_status] || 0) + 1 }), {})).map(([application_status, count]) => ({ application_status, count }));
            return [...new Set(records.map(record => record.graduation_year).filter(Boolean))].map(graduation_year => ({ graduation_year }));
        }
    });
    override(db.AuditLog, { create: async (fields, options) => { if (settings.failAudit) throw new Error("Audit failed"); if (fields.action === "membership.application.submitted") assert.ok(options.transaction); state.audits.push(fields); return fields; } });
    override(db.sequelize, { transaction: async action => {
        const previous = structuredClone(state);
        try { const result = await action({ LOCK: { UPDATE: "UPDATE" } }); calls.commits += 1; return result; }
        catch (error) { state = previous; calls.rollbacks += 1; throw error; }
    } });
    override(pdf, { renderResumePdf: async html => { calls.pdf += 1; assert.match(html, /membership application form/i); if (settings.avatarUrl) assert.ok(html.includes("src=\"" + settings.avatarUrl + "\" alt=\"Applicant profile photo\"")); return Buffer.from("%PDF-1.7\nfixture"); } });
    try { await run({ state: () => state, calls }); } finally { for (const [target, changes] of backups.reverse()) Object.assign(target, changes); }
}
test.after(async () => db.sequelize.close());

test("validation retains six canonical sections and rejects caller-controlled identities and statuses", () => {
    const body = complete(); body.alumni_user_id = 99; body.application_status = "approved"; body.personal_details.password = "not accepted"; body.consent_accepted_at = "fabricated";
    const clean = validation.normalizeMembership(body, true);
    assert.equal(clean.personal_details.social_media_account, "@alex"); assert.equal(clean.work_experience[0].agency_employer, "Office"); assert.equal(clean.community_involvement[0].designation, "Volunteer"); assert.equal(clean.educational_attainment[0].competency, "Software");
    assert.equal(clean.alumni_user_id, undefined); assert.equal(clean.application_status, undefined); assert.equal(clean.consent_accepted_at, undefined); assert.equal(clean.personal_details.password, undefined);
});
test("submission requires explicit consent and essential contact fields while sensitive fields remain optional", () => {
    const body = complete(); delete body.consent_accepted; assert.throws(() => validation.normalizeMembership(body, true), /declaration/);
    body.consent_accepted = true; body.personal_details.email = "invalid"; assert.throws(() => validation.normalizeMembership(body, true), /email/);
    delete body.personal_details.last_name; assert.throws(() => validation.normalizeMembership(body, true), /last name/);
    assert.doesNotThrow(() => validation.normalizeMembership({}, false));
    assert.doesNotThrow(() => validation.normalizeMembership({ personal_details: { first_name: "Alex", last_name: "Graduate", email: "alex@example.com", contact_number: "09123456789" }, consent_accepted: true }, true));
});
test("invalid rows, future dates, and contradictory none options fail validation", () => {
    for (const body of [{ work_experience: {} }, { awards_citations: [null] }, { options: { no_work_experience: "true" } }, { personal_details: { date_of_birth: "2999-02-01" } }, { personal_details: { date_of_birth: "2026-02-30" } }, { ...complete(), options: { no_work_experience: true } }, { work_experience: new Array(101).fill({}) }]) assert.throws(() => validation.normalizeMembership(body), { status: 400 });
});
test("own status includes official prefill and server consent without creating records", async () => fixture(async context => {
    const res = response(); await controller.getMyApplication(request(), res);
    assert.equal(res.body.application, null); assert.equal(res.body.prefill.academic_verified, true); assert.equal(res.body.prefill.academic_summary.academic_program, "Verified BSIT"); assert.equal(res.body.prefill.personal_details.email, "registered@example.com"); assert.equal(res.body.consent.text, validation.CONSENT_TEXT); assert.equal(res.body.completion.submitted, false); assert.equal(res.headers["Cache-Control"], "private, no-store"); assert.equal(context.state().applications.length, 0);
}));
test("draft persistence stays owner-scoped and partial updates retain unmodified sections", async () => fixture(async context => {
    const body = complete(); body.alumni_user_id = 99; body.application_status = "submitted"; const res = response(); await controller.saveDraft(request(body), res);
    assert.equal(res.statusCode, 201); assert.equal(res.body.application.alumni_user_id, 7); assert.equal(res.body.application.application_status, "draft"); assert.equal(res.body.application.consent_accepted, false);
    await controller.saveDraft(request({ awards_citations: [{ award: "Updated" }] }), response()); assert.equal(context.state().applications.length, 1); assert.equal(context.state().applications[0].work_experience[0].agency_employer, "Office"); assert.equal(context.state().applications[0].awards_citations[0].award, "Updated");
}));
test("education draft reload retains all user fields while Registrar academic fields remain authoritative", async () => fixture(async context => {
    const education = ["Elementary", "High School", "Technical / Vocational", "Bachelor's Degree", "Master's Degree", "Doctorate Degree"].map((level, i) => ({
        level, school_name: `School ${i}`, address: `Address ${i}`, year_graduated: `200${i}`, honors_awards: `Award ${i}`,
        program: i >= 3 ? `Program ${i}` : "", competency: i === 2 ? "Electrical Installation NC II" : ""
    }));
    const input = { ...complete(), educational_attainment: education };
    const saved = response(); await controller.saveDraft(request(input), saved);
    assert.equal(saved.statusCode, 201);
    const loaded = response(); await controller.getMyApplication(request(), loaded);
    const rows = loaded.body.application.educational_attainment;
    assert.equal(rows.length, 6);
    for (let i = 0; i < 6; i++) {
        assert.equal(rows[i].address, education[i].address);
        assert.equal(rows[i].honors_awards, education[i].honors_awards);
        assert.equal(rows[i].competency, education[i].competency);
        if (i !== 3) assert.deepEqual(rows[i], education[i]);
    }
    assert.equal(rows[3].program, "Verified BSIT");
    assert.equal(rows[3].school_name, "Don Jose Ecleo Memorial College");
    assert.equal(rows[3].year_graduated, "2026");
    rows[2].competency = "Updated competency";
    await controller.saveDraft(request({ educational_attainment: rows }), response());
    const reopened = response(); await controller.getMyApplication(request(), reopened);
    assert.equal(reopened.body.application.educational_attainment[2].competency, "Updated competency");
    assert.equal(reopened.body.application.educational_attainment[4].program, "Program 4");
}));

test("submitted data is immutable and retries reuse one application and one audit", async () => fixture(async context => {
    await controller.saveDraft(request(complete()), response()); const submitted = response(); await controller.submitApplication(request(complete()), submitted);
    assert.equal(submitted.statusCode, 200); assert.equal(submitted.body.application.application_status, "submitted"); assert.equal(submitted.body.completion.submitted, true); assert.equal(submitted.body.application.consent_version, validation.CONSENT_VERSION); assert.equal(submitted.body.application.consent_text, validation.CONSENT_TEXT); assert.ok(submitted.body.application.submitted_at); assert.equal(submitted.body.application.academic_program, "Verified BSIT");
    const retry = response(); await controller.submitApplication(request({ ...complete(), personal_details: { first_name: "Changed" } }), retry); assert.equal(retry.statusCode, 200); assert.equal(retry.body.reused, true); assert.equal(retry.body.application.personal_details.first_name, "Alex"); assert.equal(context.state().applications.length, 1); assert.equal(context.state().audits.length, 1); assert.deepEqual(context.state().audits[0].metadata, { consent_version: validation.CONSENT_VERSION });
    const edited = response(); await controller.saveDraft(request(complete()), edited); assert.equal(edited.statusCode, 409);
}));
test("failed consent validation leaves no application", async () => fixture(async context => {
    const body = complete(); body.consent_accepted = false; const res = response(); await controller.submitApplication(request(body), res); assert.equal(res.statusCode, 400); assert.equal(context.state().applications.length, 0); assert.equal(context.calls.rollbacks, 1);
}));
test("save and audit failures roll back without exposing private SQL", async () => {
    for (const settings of [{ failSave: true }, { failAudit: true }]) await fixture(async context => { const res = response(); await controller.submitApplication(request(complete()), res); assert.equal(res.statusCode, 500); assert.equal(context.state().applications.length, 0); assert.equal(context.calls.rollbacks, 1); assert.ok(!JSON.stringify(res.body).includes("Private")); }, settings);
});
test("DB account role and verification override stale or forged JWT claims", async () => {
    for (const settings of [{ status: "pending" }, { status: "suspended" }, { role: "employer" }, { role: "admin", grant: true }]) await fixture(async context => { const res = response(); await controller.submitApplication(request(complete()), res); assert.equal(res.statusCode, 403); assert.equal(context.state().applications.length, 0); }, settings);
});
test("missing user and unauthenticated requests are rejected", async () => {
    await fixture(async () => { const res = response(); await controller.getMyApplication(request({}, null), res); assert.equal(res.statusCode, 401); });
    await fixture(async () => { const res = response(); await controller.getMyApplication(request(), res); assert.equal(res.statusCode, 401); }, { missingUser: true });
});
test("own endpoints ignore attempts to select another account's application", async () => fixture(async () => {
    await controller.submitApplication(request(complete(), 7), response()); const req = request({}, 8); req.params.id = 1; req.query.alumni_user_id = 7; const res = response(); await controller.getMyApplication(req, res); assert.equal(res.body.application, null); const exported = response(); await controller.getMyPdf(req, exported); assert.equal(exported.statusCode, 404);
}));
test("administration requires an active grant and current verified Admin Alumni scope", async () => {
    for (const settings of [{ role: "employer", grant: true }, { role: "admin", scope: "registrar", grant: true }, { role: "admin", scope: "employer", grant: true }, { role: "admin", status: "suspended", grant: true }, { role: "admin", grant: false }]) await fixture(async () => { const access = response(); await controller.getAccess(request(), access); assert.equal(access.body.can_manage, false); const list = response(); await controller.listApplications(request(), list); assert.equal(list.statusCode, 403); }, settings);
    await fixture(async () => { const res = response(); await controller.getAccess(request(), res); assert.equal(res.body.can_manage, true); }, { role: "admin", grant: true });
});
test("authorized Admin Alumni can view submitted forms without receiving approval permission", async () => fixture(async context => {
    context.state().applications.push({ id: 4, application_status: "submitted", applicant_name: "Saved Name", personal_details: { email: "saved@example.invalid", tin: "Never in list" }, submitted_at: new Date() });
    const access = response(); await controller.getAccess(request(), access);
    assert.equal(access.body.can_view, true); assert.equal(access.body.can_approve, false);
    const list = response(); await controller.listApplications(request(), list);
    assert.equal(list.statusCode, 200); assert.equal(list.body.applications[0].email, "saved@example.invalid");
    assert.equal(list.body.applications[0].personal_details, undefined);
    assert.deepEqual(list.body.summary, { total: 1, pending_review: 1, approved: 0, for_correction: 0 });
    const req = request(); req.params.id = "4";
    const detail = response(); await controller.getApplication(req, detail); assert.equal(detail.body.application.id, 4);
}, { role: "admin", scope: "alumni", grant: true }));

test("all management data and document endpoints reject former roles even with an active old grant", async () => {
    for (const settings of [{ role: "admin", scope: "registrar", grant: true }, { role: "admin", scope: "employer", grant: true }, { role: "employer", grant: true }, { role: "alumni", grant: true }]) await fixture(async context => {
        context.state().applications.push({ id: 1, alumni_user_id: 8, application_status: "submitted", ...complete() });
        for (const action of [controller.listApplications, controller.getApplication, controller.getApplicationDocument, controller.getApplicationPdf]) {
            const req = request(); req.params.id = "1";
            // Claiming the destination role in a stale or forged token must not override the DB account.
            req.user.role = "admin"; req.user.admin_scope = "alumni";
            const res = response(); await action(req, res); assert.equal(res.statusCode, 403);
            assert.equal(res.headers["Cache-Control"], "private, no-store");
            assert.ok(!JSON.stringify(res.body).includes("Private TIN"));
        }
        assert.equal(context.calls.pdf, 0);
    }, settings);
});

test("Admin Alumni without an active grant cannot read forms or export them", async () => fixture(async context => {
    context.state().applications.push({ id: 1, application_status: "submitted", ...complete() });
    for (const action of [controller.getApplication, controller.getApplicationDocument, controller.getApplicationPdf]) {
        const req = request(); req.params.id = "1"; const res = response(); await action(req, res); assert.equal(res.statusCode, 403);
    }
    assert.equal(context.calls.pdf, 0);
}, { role: "admin", scope: "alumni", grant: false }));
test("admin list returns submitted summaries with pagination and no sensitive details", async () => fixture(async context => {
    context.state().applications.push({ id: 1, application_status: "draft", applicant_name: "Draft" }, { id: 2, application_status: "submitted", applicant_name: "Alex Graduate", academic_program: "BSIT", graduation_year: 2026, submitted_at: new Date(), personal_details: { tin: "Sensitive" } }); const req = request(); req.query = { search: "AlEX_%", page_size: "1000", page: "-1" }; const res = response(); await controller.listApplications(req, res); assert.equal(res.body.total, 1); assert.equal(res.body.page, 1); assert.equal(res.body.page_size, 100); assert.equal(res.body.applications[0].name, "Alex Graduate"); assert.equal(res.body.applications[0].personal_details, undefined); assert.equal(res.body.applications[0].alumni_user_id, undefined); assert.deepEqual(context.calls.lists[0].order, [["submitted_at", "DESC"], ["id", "DESC"]]);
}, { role: "admin", grant: true }));
test("detail and exports use saved submitted data instead of client HTML", async () => fixture(async context => {
    context.state().applications.push({ id: 1, alumni_user_id: 8, application_status: "submitted", ...complete(), consent_text: validation.CONSENT_TEXT, submitted_at: new Date() }); const req = request({ html: "<script>unsafe()</script>" }); req.params.id = "1"; const detail = response(); await controller.getApplication(req, detail); assert.equal(detail.body.application.personal_details.first_name, "Alex"); const document = response(); await controller.getApplicationDocument(req, document); assert.ok(document.body.html.includes("Alex")); assert.ok(!document.body.html.includes("unsafe()")); assert.ok(document.body.html.includes("src=\"data:image/jpeg;base64,YWJj\" alt=\"Applicant profile photo\"")); const exported = response(); await controller.getApplicationPdf(req, exported); assert.equal(exported.headers["Content-Type"], "application/pdf"); assert.ok(exported.body.subarray(0, 5).equals(Buffer.from("%PDF-"))); assert.equal(context.calls.pdf, 1);
}, { role: "admin", grant: true, avatarUrl: "data:image/jpeg;base64,YWJj" }));
test("applicants receive their current profile photo in their saved document and PDF", async () => fixture(async context => {
    context.state().applications.push({ id: 1, alumni_user_id: 7, application_status: "submitted", ...complete(), consent_text: validation.CONSENT_TEXT, submitted_at: new Date() });
    const document = response(); await controller.getMyDocument(request(), document);
    assert.equal(document.statusCode, 200);
    assert.ok(document.body.html.includes("src=\"data:image/jpeg;base64,YWJj\" alt=\"Applicant profile photo\""));
    const pdfResult = response(); await controller.getMyPdf(request(), pdfResult);
    assert.equal(pdfResult.headers["Content-Type"], "application/pdf");
}, { avatarUrl: "data:image/jpeg;base64,YWJj" }));

test("invalid and missing application IDs fail; ordinary employers cannot render PDF", async () => {
    await fixture(async () => { const req = request(); req.params.id = "../1"; const res = response(); await controller.getApplication(req, res); assert.equal(res.statusCode, 400); req.params.id = "1"; const missing = response(); await controller.getApplication(req, missing); assert.equal(missing.statusCode, 404); }, { role: "admin", grant: true });
    await fixture(async context => { const req = request(); req.params.id = "1"; const res = response(); await controller.getApplicationPdf(req, res); assert.equal(res.statusCode, 403); assert.equal(context.calls.pdf, 0); }, { role: "employer", grant: true });
});
test("missing schema yields actionable failure instead of empty success", async () => fixture(async () => {
    const res = response(); await controller.getMyApplication(request(), res); assert.equal(res.statusCode, 503); assert.match(res.body.msg, /migration/);
}, { schemaMissing: true }));
test("verified official bachelor fields are canonicalized without altering other education or submitted snapshots", async () => fixture(async context => {
    const body = complete(); body.educational_attainment = [{ level: "Bachelor's Degree", school_name: "Tampered school", program: "Tampered course", year_graduated: "2000", honors_awards: "Graduate Honors" }, { level: "Master's", school_name: "Other University", program: "Advanced Program", year_graduated: "2027" }];
    const res = response(); await controller.submitApplication(request(body), res); assert.equal(res.statusCode, 201);
    const education = res.body.application.educational_attainment;
    assert.equal(education[0].school_name, "Don Jose Ecleo Memorial College"); assert.equal(education[0].program, "Verified BSIT"); assert.equal(education[0].year_graduated, "2026"); assert.equal(education[0].honors_awards, "Graduate Honors");
    assert.equal(education[1].school_name, "Other University"); assert.equal(education[1].program, "Advanced Program");
    const original = db.AlumniRecord.findByPk; db.AlumniRecord.findByPk = async () => ({ course: "Later Official Change", batch_year: 2027 });
    try { const retry = response(); await controller.submitApplication(request(body), retry); assert.equal(retry.body.application.educational_attainment[0].program, "Verified BSIT"); assert.equal(context.state().applications.length, 1); }
    finally { db.AlumniRecord.findByPk = original; }
}));
