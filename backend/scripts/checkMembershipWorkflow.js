"use strict";
// All fixture writes stay inside one explicit transaction, which is always rolled back.
// This check never sends email, deletes existing rows, or commits fixture users/applications.
const assert = require("node:assert/strict");
const db = require("../models");
const controller = require("../controllers/membershipController");
const { CONSENT_TEXT } = require("../services/membershipValidation");
const { saveAlumniProfile } = require("../services/alumniProfileSave");
const response = () => ({ statusCode: 200, headers: {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = JSON.parse(JSON.stringify(body)); return this; }, setHeader(key, value) { this.headers[key] = value; }, send(body) { this.body = body; return this; } });
const request = (id, body = {}, applicationId) => ({ user: { id }, body, params: { id: String(applicationId || "") }, query: {}, ip: "127.0.0.1" });

function createRollbackTransactionRunner(sequelize, outerTransaction, originalTransaction) {
    return async (optionsOrCallback, callback) => {
        if (typeof optionsOrCallback === "function" && callback === undefined) return optionsOrCallback(outerTransaction);
        // Sequelize findOrCreate creates a savepoint even when the caller provides a transaction.
        // Only savepoints explicitly parented to our enclosing rollback transaction are allowed.
        if (optionsOrCallback && typeof optionsOrCallback === "object" && optionsOrCallback.transaction === outerTransaction) {
            return originalTransaction.call(sequelize, optionsOrCallback, callback);
        }
        throw new Error("Unmanaged top-level transactions are not allowed in this rollback check.");
    };
}

async function run() {
    await db.sequelize.authenticate();
    const administrator = await db.User.findOne({ where: { role: "admin", admin_scope: "alumni", account_status: "verified" }, attributes: ["id"] });
    if (!administrator) throw new Error("This check requires the existing verified Admin Alumni and the applied membership access transfer.");
    const grant = await db.MembershipAdministrator.findOne({ where: { user_id: administrator.id, revoked_at: null }, attributes: ["id"] });
    if (!grant) throw new Error("The existing Admin Alumni must have an active membership-management grant.");
    const baseline = await db.MembershipApplication.count();
    const baselineGrants = await db.MembershipAdministrator.count();
    const baselineModels = ["User", "AlumniRecord", "AlumniProfile", "EmploymentHistory", "AuditLog"];
    const baselineCounts = Object.fromEntries(await Promise.all(baselineModels.map(async name => [name, await db[name].count()])));
    const transaction = await db.sequelize.transaction();
    const restorations = [];
    const inject = (model, method) => {
        const original = model[method];
        restorations.push(() => { model[method] = original; });
        if (method === "findByPk") model[method] = (id, options = {}) => original.call(model, id, { ...options, transaction });
        else if (method === "create") model[method] = (fields, options = {}) => original.call(model, fields, { ...options, transaction });
        else model[method] = (options = {}) => original.call(model, { ...options, transaction });
    };
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    let fixtureUserId;
    let fixtureApplicationId;
    try {
        const official = await db.AlumniRecord.create({ full_name: "Membership Workflow Fixture", student_id: `MW-${suffix}`, course: "BSIT", batch_year: 2026, email: `membership-official-${suffix}@example.invalid` }, { transaction });
        const alumni = await db.User.create({ name: `Workflow ${suffix}`, email: `membership-${suffix}@example.invalid`, password: "Unusable rollback-only fixture", role: "alumni", account_status: "verified", alumni_record_id: official.id }, { transaction });
        fixtureUserId = alumni.id;
        const otherAlumni = await db.User.create({ name: "Other Fixture", email: `membership-other-${suffix}@example.invalid`, password: "Unusable rollback-only fixture", role: "alumni", account_status: "verified" }, { transaction });
        const employer = await db.User.create({ name: "Employer Fixture", email: `membership-employer-${suffix}@example.invalid`, password: "Unusable rollback-only fixture", role: "employer", account_status: "verified" }, { transaction });
        const pendingAlumni = await db.User.create({ name: "Pending Fixture", email: `membership-pending-${suffix}@example.invalid`, password: "Unusable rollback-only fixture", role: "alumni", account_status: "pending" }, { transaction });
        const profile = await db.AlumniProfile.create({ user_id: alumni.id, course: "BSIT", graduation_year: 2026, phone: "09000000000", address: "Fixture City" }, { transaction });
        await db.EmploymentHistory.create({ alumni_id: profile.id, company_name: "Fixture Office", position: "Assistant", start_year: 2025, employment_type: "Full-time" }, { transaction });
        const originalTransaction = db.sequelize.transaction;
        restorations.push(() => { db.sequelize.transaction = originalTransaction; });
        db.sequelize.transaction = createRollbackTransactionRunner(db.sequelize, transaction, originalTransaction);
        const originalCommit = transaction.commit;
        restorations.push(() => { transaction.commit = originalCommit; });
        transaction.commit = async () => { throw new Error("The membership fixture transaction must never be committed."); };
        for (const [model, methods] of [[db.User, ["findByPk"]], [db.AlumniProfile, ["findOne"]], [db.AlumniRecord, ["findByPk"]], [db.EmploymentHistory, ["findAll"]], [db.MembershipApplication, ["findOne", "findAndCountAll", "findAll"]], [db.MembershipAdministrator, ["findOne"]], [db.AuditLog, ["create"]]]) for (const method of methods) inject(model, method);

        const loaded = response(); await controller.getMyApplication(request(alumni.id), loaded);
        assert.equal(loaded.statusCode, 200); assert.equal(loaded.body.application, null); assert.equal(loaded.body.prefill.academic_verified, true); assert.equal(loaded.body.prefill.academic_summary.academic_program, "BSIT");
        const body = { personal_details: { first_name: "Workflow", last_name: suffix, email: alumni.email, contact_number: "09000000000", current_address: "Fixture City" }, educational_attainment: loaded.body.prefill.educational_attainment, work_experience: loaded.body.prefill.work_experience, training_seminars: [{ title: "Fixture Training", date: "2026-01-01", venue: "Campus", facilitator: "Association" }], community_involvement: [{ organization: "Community", designation: "Volunteer", years: "1" }], awards_citations: [{ award: "Service", awarding_body: "Association" }], options: {}, consent_accepted: true };
        const draft = response(); await controller.saveDraft(request(alumni.id, body), draft); assert.equal(draft.statusCode, 201); assert.equal(draft.body.application.application_status, "draft");
        const noneDraft = response(); await controller.saveDraft(request(alumni.id, { awards_citations: [], options: { no_awards_citations: true } }), noneDraft); assert.equal(noneDraft.statusCode, 200); assert.equal(noneDraft.body.application.options.no_awards_citations, true); assert.deepEqual(noneDraft.body.application.awards_citations, []);
        const malformed = response(); await controller.saveDraft(request(alumni.id, { community_involvement: [null] }), malformed); assert.equal(malformed.statusCode, 400);
        const malformedBody = response(); await controller.saveDraft(request(alumni.id, []), malformedBody); assert.equal(malformedBody.statusCode, 400);
        const invalid = response(); await controller.submitApplication(request(alumni.id, { ...body, consent_accepted: false }), invalid); assert.equal(invalid.statusCode, 400);
        const unverified = response(); await controller.submitApplication(request(pendingAlumni.id, body), unverified); assert.equal(unverified.statusCode, 403);
        const submitted = response(); await controller.submitApplication(request(alumni.id, body), submitted); assert.equal(submitted.statusCode, 200); assert.equal(submitted.body.application.application_status, "submitted"); assert.equal(submitted.body.application.consent_text, CONSENT_TEXT);
        fixtureApplicationId = submitted.body.application.id;
        const retry = response(); await controller.submitApplication(request(alumni.id, body), retry); assert.equal(retry.statusCode, 200); assert.equal(retry.body.reused, true); assert.equal(retry.body.application.id, fixtureApplicationId);
        assert.equal(await db.MembershipApplication.count({ where: { alumni_user_id: alumni.id }, transaction }), 1);
        assert.equal(await db.AuditLog.count({ where: { actor_id: alumni.id, action: "membership.application.submitted" }, transaction }), 1);
        const reloaded = response(); await controller.getMyApplication(request(alumni.id), reloaded); assert.equal(reloaded.body.completion.submitted, true); assert.equal(reloaded.body.application.training_seminars[0].title, "Fixture Training"); assert.equal(reloaded.body.application.awards_citations[0].award, "Service");
        const ownOther = response(); await controller.getMyApplication(request(otherAlumni.id), ownOther); assert.equal(ownOther.body.application, null);
        const forbidden = response(); await controller.getApplication(request(employer.id, {}, fixtureApplicationId), forbidden); assert.equal(forbidden.statusCode, 403);
        const adminRequest = request(administrator.id); adminRequest.query = { search: suffix, page: "1", page_size: "10" };
        const list = response(); await controller.listApplications(adminRequest, list); assert.equal(list.statusCode, 200); assert.equal(list.body.total, 1); assert.equal(list.body.applications[0].id, fixtureApplicationId); assert.equal(list.body.applications[0].personal_details, undefined);
        assert.equal(list.body.applications[0].email, alumni.email);
        assert.ok(list.body.summary.pending_review >= 1);
        assert.ok(list.body.filter_options.graduation_years.includes(2026));
        for (const scope of ["registrar", "employer"]) {
            const formerAdmin = await db.User.findOne({ where: { role: "admin", admin_scope: scope, account_status: "verified" }, attributes: ["id"], transaction });
            assert.ok(formerAdmin, `Existing verified ${scope} admin is required for the denial check.`);
            const access = response(); await controller.getAccess(request(formerAdmin.id), access); assert.equal(access.body.can_view, false);
            for (const action of [controller.listApplications, controller.getApplication, controller.getApplicationDocument, controller.getApplicationPdf]) {
                const denied = response(); await action(request(formerAdmin.id, {}, fixtureApplicationId), denied); assert.equal(denied.statusCode, 403);
            }
        }
        const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(submitted.body.application.submitted_at));
        const part = name => parts.find(item => item.type === name).value;
        const date = `${part("year")}-${part("month")}-${part("day")}`;
        const combinedRequest = request(administrator.id); combinedRequest.query = { search: alumni.email.toUpperCase(), status: "pending_review", graduation_year: "2026", submitted_date: date, page: "1", page_size: "10" };
        const combined = response(); await controller.listApplications(combinedRequest, combined); assert.equal(combined.statusCode, 200); assert.equal(combined.body.total, 1); assert.equal(combined.body.applications[0].id, fixtureApplicationId);
        combinedRequest.query.status = "approved"; const unapproved = response(); await controller.listApplications(combinedRequest, unapproved); assert.equal(unapproved.statusCode, 200); assert.equal(unapproved.body.total, 0);
        const adminAccess = response(); await controller.getAccess(request(administrator.id), adminAccess); assert.equal(adminAccess.body.can_view, true); assert.equal(adminAccess.body.can_approve, false);
        adminRequest.query = { search: suffix, page: "2", page_size: "1" }; const nextPage = response(); await controller.listApplications(adminRequest, nextPage); assert.equal(nextPage.statusCode, 200); assert.equal(nextPage.body.total, 1); assert.deepEqual(nextPage.body.applications, []);
        const details = response(); await controller.getApplication(request(administrator.id, {}, fixtureApplicationId), details); assert.equal(details.statusCode, 200); assert.equal(details.body.application.work_experience[0].agency_employer, "Fixture Office");
        const document = response(); await controller.getApplicationDocument(request(administrator.id, {}, fixtureApplicationId), document); assert.equal(document.statusCode, 200); assert.ok(document.body.html.includes("Fixture Training")); assert.ok(document.body.html.includes("VI. AWARDS"));
        const ownDocument = response(); await controller.getMyDocument(request(alumni.id), ownDocument); assert.equal(ownDocument.statusCode, 200); assert.equal(ownDocument.body.html, document.body.html);
        for (const [action, req] of [[controller.getApplicationPdf, request(administrator.id, {}, fixtureApplicationId)], [controller.getMyPdf, request(alumni.id)]]) {
            const exported = response(); await action(req, exported); assert.equal(exported.statusCode, 200); assert.equal(exported.headers["Content-Type"], "application/pdf"); assert.ok(exported.body.subarray(0, 5).equals(Buffer.from("%PDF-"))); assert.ok(exported.body.length > 1000);
        }
        await assert.rejects(() => saveAlumniProfile({ user: alumni, body: { email: "invalid", membership_profile_completion: true }, normalizeImagePath: value => value }), { status: 400 });
        const stillIncomplete = response(); await controller.getMyApplication(request(alumni.id), stillIncomplete); assert.equal(stillIncomplete.body.completion.profile_completed, false);
        const savedProfile = await saveAlumniProfile({ user: alumni, body: { name: alumni.name, email: alumni.email, address: "Updated Fixture City", employment_status: "employed", job_title: "Updated Assistant", employment_history: [{ company_name: "Updated Fixture Office", position: "Updated Assistant", start_year: 2025, end_year: "Present", employment_type: "Full-time" }], membership_profile_completion: true }, normalizeImagePath: value => value });
        assert.equal(savedProfile.membership_profile_completed, true); assert.equal(savedProfile.user.AlumniProfile.address, "Updated Fixture City");
        const completed = response(); await controller.getMyApplication(request(alumni.id), completed); assert.equal(completed.body.completion.profile_completed, true); assert.equal(completed.body.application.id, fixtureApplicationId);
        const preservedOfficial = await db.AlumniRecord.findByPk(official.id, { transaction }); assert.equal(preservedOfficial.course, "BSIT"); assert.equal(preservedOfficial.batch_year, 2026);
        console.log("MariaDB membership workflow passed: alumni submission, Admin Alumni listing/filtering/pagination, former-role denials, identical own/admin documents, real authorized PDFs, consent, retries, reload and profile completion. Transaction will be rolled back.");
    } finally {
        for (const restore of restorations.reverse()) restore();
        await transaction.rollback();
        // These checks run even when a workflow assertion fails before the last step.
        assert.equal(await db.MembershipApplication.count(), baseline, "Existing membership record count remains unchanged after rollback");
        assert.equal(await db.MembershipAdministrator.count(), baselineGrants, "Existing administrator grants remain unchanged after rollback");
        assert.equal((await db.MembershipAdministrator.findByPk(grant.id)).revoked_at, null, "Original grant remains active after rollback");
        if (fixtureUserId) assert.equal(await db.User.count({ where: { id: fixtureUserId } }), 0, "Fixture user was rolled back");
        if (fixtureApplicationId) assert.equal(await db.MembershipApplication.count({ where: { id: fixtureApplicationId } }), 0, "Fixture application was rolled back");
        for (const name of baselineModels) assert.equal(await db[name].count(), baselineCounts[name], `${name} count remains unchanged after rollback`);
        console.log("Confirmed rollback: no fixture users or applications remain; all checked record counts and the existing administrator grant are unchanged.");
    }
}
if (require.main === module) run().catch(error => { console.error(`Membership workflow check failed: ${error.message}`); process.exitCode = 1; }).finally(() => db.sequelize.close());
module.exports = { run, createRollbackTransactionRunner };
