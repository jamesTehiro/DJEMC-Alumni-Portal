const { Op, fn, col, literal, where: expression } = require("sequelize");
const SUBMITTED_STATUSES = ["submitted", "pending_review", "approved", "for_correction"];
const invalid = message => { throw Object.assign(new Error(message), { status: 400 }); };
const submittedMembershipWhere = () => ({ application_status: { [Op.in]: SUBMITTED_STATUSES } });
// Sequelize v6 doubles dollar signs in plain fn string arguments. This fixed,
// non-user-supplied JSON path must reach MariaDB as $.email, not $$.email.
const emailExpression = () => fn("JSON_UNQUOTE", fn("JSON_EXTRACT", col("personal_details"), literal("'$.email'")));

function membershipListQuery(query = {}) {
    const page = Math.max(1, Math.min(100000, Number.parseInt(query.page, 10) || 1));
    const page_size = Math.max(1, Math.min(100, Number.parseInt(query.page_size, 10) || 10));
    const where = submittedMembershipWhere();
    const search = String(query.search || "").trim().slice(0, 120);
    if (search) {
        const pattern = `%${search.toLowerCase().replace(/[\\%_]/g, value => `\\${value}`)}%`;
        where[Op.or] = [expression(fn("LOWER", col("applicant_name")), { [Op.like]: pattern }), expression(fn("LOWER", emailExpression()), { [Op.like]: pattern })];
    }
    const status = String(query.status || "").trim();
    if (status) {
        if (!SUBMITTED_STATUSES.includes(status)) invalid("Invalid membership application status filter.");
        where.application_status = status === "submitted" || status === "pending_review" ? { [Op.in]: ["submitted", "pending_review"] } : status;
    }
    const year = String(query.graduation_year || "").trim();
    if (year) {
        if (!/^\d{4}$/.test(year) || Number(year) < 1900) invalid("Enter a valid graduation year filter.");
        where.graduation_year = Number(year);
    }
    const date = String(query.submitted_date || "").trim();
    if (date) {
        const calendar = new Date(`${date}T00:00:00Z`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== date) invalid("Enter a valid submission date filter.");
        // Submission dates in this portal are shown in the user's Manila timezone.
        const start = new Date(`${date}T00:00:00+08:00`);
        where.submitted_at = { [Op.gte]: start, [Op.lt]: new Date(start.getTime() + 86400000) };
    }
    return { where, page, page_size, offset: (page - 1) * page_size, limit: page_size };
}

function membershipSummary(rows) {
    const result = { total: 0, pending_review: 0, approved: 0, for_correction: 0 };
    for (const row of rows) {
        const value = row?.toJSON ? row.toJSON() : row;
        const count = Math.max(0, Number(value.count) || 0);
        if (!SUBMITTED_STATUSES.includes(value.application_status)) continue;
        result.total += count;
        result[value.application_status === "submitted" ? "pending_review" : value.application_status] += count;
    }
    return result;
}
module.exports = { SUBMITTED_STATUSES, submittedMembershipWhere, emailExpression, membershipListQuery, membershipSummary };
