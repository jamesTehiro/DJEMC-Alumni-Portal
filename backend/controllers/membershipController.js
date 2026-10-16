"use strict";
const db = require("../models");
const { Op } = require("sequelize");
const { CONSENT_TEXT, CONSENT_VERSION, normalizeMembership, ROW_FIELDS } = require("../services/membershipValidation");
const documentService = require("../services/membershipDocument");
const pdfService = require("../services/resumePdf");
const audit = require("../services/auditService");
const { SUBMITTED_STATUSES, submittedMembershipWhere, emailExpression, membershipListQuery, membershipSummary } = require("../services/membershipListing");

const failure = (status, message) => Object.assign(new Error(message), { status });
const safeId = value => /^\d+$/.test(String(value || "")) && Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
const toPlain = row => row?.toJSON ? row.toJSON() : row ? { ...row } : null;
const completion = application => ({ submitted: SUBMITTED_STATUSES.includes(application?.application_status), profile_completed: Boolean(application?.profile_completed_at) });
const privateResponse = res => res.setHeader("Cache-Control", "private, no-store");
const jsonFields = ["personal_details", ...Object.keys(ROW_FIELDS), "options"];

function applicationJson(row) {
    const value = toPlain(row);
    if (!value) return null;
    for (const field of jsonFields) {
        if (typeof value[field] === "string") value[field] = JSON.parse(value[field]);
    }
    return value;
}

async function loadUser(req, transaction, lock = false) {
    const id = safeId(req.user?.id);
    if (!id) throw failure(401, "Please sign in to continue.");
    const user = await db.User.findByPk(id, {
        attributes: ["id", "name", "email", "role", "admin_scope", "account_status", "alumni_record_id"],
        ...(transaction ? { transaction, ...(lock ? { lock: transaction.LOCK.UPDATE } : {}) } : {})
    });
    if (!user) throw failure(401, "This account is no longer available. Please sign in again.");
    return user;
}

async function verifiedAlumni(req, transaction, lock = false) {
    const user = await loadUser(req, transaction, lock);
    if (user.role !== "alumni" || user.account_status !== "verified") throw failure(403, "Only verified alumni may access a membership application.");
    return user;
}

async function canManage(user) {
    if (user.role !== "admin" || user.admin_scope !== "alumni" || user.account_status !== "verified") return false;
    return Boolean(await db.MembershipAdministrator.findOne({ where: { user_id: user.id, revoked_at: null }, attributes: ["id"] }));
}

async function membershipAdministrator(req) {
    const user = await loadUser(req);
    if (!await canManage(user)) throw failure(403, "Authorized Admin Alumni membership access is required to view these applications.");
    return user;
}

async function getMembershipPrefill(user, transaction) {
    const queryOptions = transaction ? { transaction } : {};
    const profile = await db.AlumniProfile.findOne({ where: { user_id: user.id }, attributes: ["id", "phone", "address", "course", "graduation_year", "job_title", "current_company"], ...queryOptions });
    const official = user.alumni_record_id ? await db.AlumniRecord.findByPk(user.alumni_record_id, { attributes: ["id", "course", "batch_year"], ...queryOptions }) : null;
    const academic_program = official?.course || profile?.course || null;
    const graduation_year = official?.batch_year || profile?.graduation_year || null;
    const nameParts = String(user.name || "").trim().split(/\s+/).filter(Boolean);
    const first_name = nameParts.length > 1 ? nameParts.slice(0, -1).join(" ") : nameParts[0] || "";
    const last_name = nameParts.length > 1 ? nameParts.at(-1) : "";
    const histories = profile ? await db.EmploymentHistory.findAll({ where: { alumni_id: profile.id }, attributes: ["company_name", "position", "start_year", "end_year", "employment_type"], order: [["start_year", "DESC"], ["id", "DESC"]], ...queryOptions }) : [];
    return {
        personal_details: { first_name, last_name, email: user.email || "", contact_number: profile?.phone || "", current_address: profile?.address || "", designation: profile?.job_title || "", agency_office: profile?.current_company || "" },
        educational_attainment: academic_program || graduation_year ? [{ level: "Bachelor's", school_name: "Don Jose Ecleo Memorial College", address: "", year_graduated: graduation_year ? String(graduation_year) : "", honors_awards: "", program: academic_program || "", competency: "" }] : [],
        work_experience: histories.map(item => ({ employment_period: `${item.start_year || ""} - ${item.end_year || "Present"}`, position: item.position || "", agency_employer: item.company_name || "", employment_status: item.employment_type || "" })),
        academic_summary: { academic_program, graduation_year, source: official ? "official_record" : profile ? "profile" : null },
        academic_verified: Boolean(official)
    };
}

function respondError(error, res) {
    const code = error.original?.code || error.parent?.code || error.code;
    if (code === "ER_NO_SUCH_TABLE" || code === "ER_BAD_FIELD_ERROR") return res.status(503).json({ msg: "Membership applications are not ready. The administrator must apply the membership migration before using this feature." });
    if (error.status >= 400 && error.status < 600) return res.status(error.status).json({ msg: error.message, ...(error.field ? { field: error.field } : {}) });
    // SQL errors can contain submitted personal data. Log only their error code/name.
    console.error("[membership] Operation failed:", code || error.name || "UnknownError");
    return res.status(500).json({ msg: "Unable to complete the membership request. Please try again." });
}

const endpoint = action => async (req, res) => {
    privateResponse(res);
    try { await action(req, res); } catch (error) { respondError(error, res); }
};

exports.getMyApplication = endpoint(async (req, res) => {
    const user = await verifiedAlumni(req);
    const application = applicationJson(await db.MembershipApplication.findOne({ where: { alumni_user_id: user.id } }));
    const prefill = await getMembershipPrefill(user);
    res.json({ application, prefill, completion: completion(application), consent: { text: CONSENT_TEXT, version: CONSENT_VERSION } });
});

async function writeApplication(req, res, submit) {
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) throw failure(400, "The membership application must contain an object.");
    const result = await db.sequelize.transaction(async transaction => {
        const user = await verifiedAlumni(req, transaction, true);
        const existing = await db.MembershipApplication.findOne({ where: { alumni_user_id: user.id }, transaction, lock: transaction.LOCK.UPDATE });
        if (SUBMITTED_STATUSES.includes(existing?.application_status)) {
            if (!submit) throw failure(409, "This membership application has already been submitted and cannot be edited.");
            return { application: applicationJson(existing), reused: true, created: false };
        }
        const prior = applicationJson(existing) || {};
        const payload = normalizeMembership({ ...prior, ...req.body }, submit);
        const prefill = await getMembershipPrefill(user, transaction);
        if (prefill.academic_verified && prefill.educational_attainment.length) {
            const officialEducation = prefill.educational_attainment[0];
            const isBachelor = value => ["bachelor", "bachelors", "bachelordegree", "bachelorsdegree"].includes(String(value || "").toLowerCase().replace(/[^a-z]/g, ""));
            let education = payload.educational_attainment.find(item => isBachelor(item.level));
            if (!education) { education = { ...officialEducation }; payload.educational_attainment.push(education); }
            Object.assign(education, { level: officialEducation.level, school_name: officialEducation.school_name,
                program: officialEducation.program, year_graduated: officialEducation.year_graduated });
        }
        if (prefill.academic_verified && prefill.educational_attainment.length) {
            const officialEducation = prefill.educational_attainment[0];
            const isBachelor = value => ["bachelor", "bachelors", "bachelordegree", "bachelorsdegree"].includes(String(value || "").toLowerCase().replace(/[^a-z]/g, ""));
            let education = payload.educational_attainment.find(item => isBachelor(item.level));
            if (!education) { education = { ...officialEducation }; payload.educational_attainment.push(education); }
            Object.assign(education, { level: officialEducation.level, school_name: officialEducation.school_name,
                program: officialEducation.program, year_graduated: officialEducation.year_graduated });
        }
        const details = payload.personal_details;
        const fields = {
            ...payload, alumni_user_id: user.id,
            applicant_name: [details.first_name, details.middle_name, details.last_name, details.extension].filter(Boolean).join(" "),
            academic_program: prefill.academic_summary.academic_program,
            graduation_year: prefill.academic_summary.graduation_year,
            application_status: submit ? "submitted" : "draft"
        };
        if (submit) {
            const submittedAt = new Date();
            Object.assign(fields, { consent_accepted: true, consent_accepted_at: submittedAt, consent_text: CONSENT_TEXT, consent_version: CONSENT_VERSION, submitted_at: submittedAt });
        }
        const saved = existing ? await existing.update(fields, { transaction }) : await db.MembershipApplication.create(fields, { transaction });
        if (submit) await db.AuditLog.create({ actor_id: user.id, actor_role: "alumni", action: "membership.application.submitted", target_type: "membership_application", target_id: saved.id, metadata: { consent_version: CONSENT_VERSION }, ip_address: req.ip || null }, { transaction });
        return { application: applicationJson(saved), reused: false, created: !existing };
    });
    res.status(result.created ? 201 : 200).json({ application: result.application, completion: completion(result.application), reused: result.reused,
        msg: submit ? "Membership Application Submitted Successfully!" : "Membership application draft saved." });
}

exports.saveDraft = endpoint((req, res) => writeApplication(req, res, false));
exports.submitApplication = endpoint((req, res) => writeApplication(req, res, true));
exports.getAccess = endpoint(async (req, res) => {
    const user = await loadUser(req);
    const allowed = await canManage(user);
    res.json({ can_manage: allowed, can_view: allowed, can_approve: false, scope: user.admin_scope || null });
});

exports.listApplications = endpoint(async (req, res) => {
    await membershipAdministrator(req);
    const { where, page, page_size, offset, limit } = membershipListQuery(req.query);
    const [result, totals, years] = await Promise.all([
        db.MembershipApplication.findAndCountAll({ where, attributes: ["id", "applicant_name", [emailExpression(), "email"], "academic_program", "graduation_year", "submitted_at", "application_status"], order: [["submitted_at", "DESC"], ["id", "DESC"]], offset, limit }),
        db.MembershipApplication.findAll({ where: submittedMembershipWhere(), attributes: ["application_status", [db.Sequelize.fn("COUNT", db.Sequelize.col("id")), "count"]], group: ["application_status"], raw: true }),
        db.MembershipApplication.findAll({ where: { ...submittedMembershipWhere(), graduation_year: { [Op.ne]: null } }, attributes: ["graduation_year"], group: ["graduation_year"], order: [["graduation_year", "DESC"]], raw: true })
    ]);
    res.json({ applications: result.rows.map(row => { const { applicant_name, ...value } = toPlain(row); return { ...value, name: applicant_name }; }), total: result.count, page, page_size,
        summary: membershipSummary(totals), filter_options: { graduation_years: years.map(row => Number(row.graduation_year)).filter(Number.isInteger) } });
});

async function getAdminApplication(req) {
    const user = await membershipAdministrator(req);
    const id = safeId(req.params.id);
    if (!id) throw failure(400, "Invalid membership application ID.");
    const application = applicationJson(await db.MembershipApplication.findOne({ where: { id, ...submittedMembershipWhere() } }));
    if (!application) throw failure(404, "The submitted membership application could not be found.");
    return { user, application };
}

async function getOwnSubmittedApplication(req) {
    const user = await verifiedAlumni(req);
    const application = applicationJson(await db.MembershipApplication.findOne({ where: { alumni_user_id: user.id, ...submittedMembershipWhere() } }));
    if (!application) throw failure(404, "Submit your membership application before opening the saved document.");
    return { user, application };
}

async function recordView(req, user, application, action) {
    await audit.log({ actorId: user.id, actorRole: user.role, action, targetType: "membership_application", targetId: application.id, metadata: null, ipAddress: req.ip || null });
}

exports.getApplication = endpoint(async (req, res) => {
    const { user, application } = await getAdminApplication(req);
    await recordView(req, user, application, "membership.application.viewed");
    res.json({ application });
});

const documentEndpoint = own => endpoint(async (req, res) => {
    const { user, application } = await (own ? getOwnSubmittedApplication(req) : getAdminApplication(req));
    const html = documentService.buildMembershipDocumentHtml(application);
    await recordView(req, user, application, "membership.application.document_viewed");
    res.json({ html });
});
const pdfEndpoint = own => endpoint(async (req, res) => {
    const { user, application } = await (own ? getOwnSubmittedApplication(req) : getAdminApplication(req));
    const html = documentService.buildMembershipDocumentHtml(application);
    let pdf;
    try {
        pdf = await pdfService.renderResumePdf(html);
    } catch (error) {
        // Keep applicant data and environment details out of logs while recording
        // the runtime cause needed to diagnose a failed browser launch/render.
        const reason = String(error?.message || error?.name || "Unknown error")
            .replace(/https?:\/\/\S+/gi, "[url]")
            .slice(0, 240);
        console.error("[membership] PDF generation failed:", error?.name || "Error", reason);
        throw error;
    }
    await recordView(req, user, application, "membership.application.pdf_downloaded");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="DJEMC-Membership-Application-${application.id}.pdf"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(pdf);
});
exports.getMyDocument = documentEndpoint(true);
exports.getMyPdf = pdfEndpoint(true);
exports.getApplicationDocument = documentEndpoint(false);
exports.getApplicationPdf = pdfEndpoint(false);
exports.getMembershipPrefill = getMembershipPrefill;

