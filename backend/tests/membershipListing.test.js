const test = require("node:test");
const assert = require("node:assert/strict");
const { Op } = require("sequelize");
const { membershipListQuery, membershipSummary, submittedMembershipWhere } = require("../services/membershipListing");
const db = require("../models");
const { emailExpression } = require("../services/membershipListing");
test.after(() => db.sequelize.close());

test("Sequelize emits the real MariaDB JSON email path without doubling its dollar sign", () => {
    const sql = db.sequelize.dialect.queryGenerator.selectQuery("MembershipApplications", { attributes: [[emailExpression(), "email"]] });
    assert.ok(sql.includes("'$.email'")); assert.ok(!sql.includes("'$$.email'"));
});

test("membership filters combine name/email search, actual status, year, date and pagination", () => {
    const query = membershipListQuery({ search: "Alum_%@Example.com", status: "pending_review", graduation_year: "2026", submitted_date: "2026-10-14", page: "2", page_size: "25" });
    assert.deepEqual(query.where.application_status[Op.in], ["submitted", "pending_review"]);
    assert.equal(query.where.graduation_year, 2026);
    assert.equal(query.where[Op.or].length, 2);
    assert.equal(query.where[Op.or][1].attribute.fn, "LOWER");
    assert.equal(query.where[Op.or][1].attribute.args[0].fn, "JSON_UNQUOTE");
    assert.equal(query.where[Op.or][1].logic[Op.like], "%alum\\_\\%@example.com%");
    assert.equal(query.where.submitted_at[Op.gte].toISOString(), "2026-10-13T16:00:00.000Z");
    assert.equal(query.where.submitted_at[Op.lt].toISOString(), "2026-10-14T16:00:00.000Z");
    assert.equal(query.offset, 25); assert.equal(query.limit, 25);
});
test("drafts and verification values are not accepted as membership review filters", () => {
    assert.ok(!submittedMembershipWhere().application_status[Op.in].includes("draft"));
    for (const status of ["verified", "not verified", "draft", "archived", "pending; DROP TABLE Users"]) assert.throws(() => membershipListQuery({ status }), { status: 400 });
});
test("invalid dates and graduation year filters fail with a validation response", () => {
    for (const submitted_date of ["2026-02-30", "14/10/2026", "2026-99-10", "invalid"]) assert.throws(() => membershipListQuery({ submitted_date }), { status: 400 });
    for (const graduation_year of ["2026-2023", "199", "year", "-2026"]) assert.throws(() => membershipListQuery({ graduation_year }), { status: 400 });
});
test("summary uses real membership counts, maps submitted to pending review, excludes drafts", () => {
    assert.deepEqual(membershipSummary([{ application_status: "submitted", count: "3" }, { application_status: "pending_review", count: "2" }, { application_status: "approved", count: "1" }, { application_status: "for_correction", count: "4" }, { application_status: "draft", count: 9 }]), { total: 10, pending_review: 5, approved: 1, for_correction: 4 });
    assert.deepEqual(membershipSummary([]), { total: 0, pending_review: 0, approved: 0, for_correction: 0 });
});
test("cleared filters retain only submitted records and safe pagination limits", () => {
    const query = membershipListQuery({ search: "", status: "", graduation_year: "", submitted_date: "", page: "-5", page_size: "9999" });
    assert.equal(query.page, 1); assert.equal(query.limit, 100);
    assert.equal(query.where[Op.or], undefined); assert.equal(query.where.submitted_at, undefined);
});
