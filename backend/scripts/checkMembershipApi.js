// HTTP smoke checks use existing accounts read-only. No applications are submitted.
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const db = require("../models");
const base = `http://127.0.0.1:${process.env.PORT || 5000}/api`;
let checks = 0;
async function check(path, user, expected, method = "GET", body) {
    const token = user ? jwt.sign({ id: user.id, role: user.role, admin_scope: user.admin_scope }, process.env.JWT_SECRET, { expiresIn: "5m" }) : null;
    const result = await fetch(`${base}${path}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000) });
    const data = await result.json();
    assert.equal(result.status, expected, `${method} ${path}: expected ${expected}, received ${result.status}`);
    checks += 1;
    console.log(`PASS ${method} ${path} ${expected}`);
    return data;
}
async function run() {
    await db.sequelize.authenticate();
    const attrs = ["id", "role", "admin_scope", "account_status"];
    const admin = await db.User.findOne({ where: { role: "admin", admin_scope: "alumni", account_status: "verified" }, attributes: attrs });
    const employerAdmin = await db.User.findOne({ where: { role: "admin", admin_scope: "employer", account_status: "verified" }, attributes: attrs });
    const alumni = await db.User.findOne({ where: { role: "alumni", account_status: "verified" }, attributes: attrs });
    const employer = await db.User.findOne({ where: { role: "employer" }, attributes: attrs });
    const registrar = await db.User.findOne({ where: { role: "admin", admin_scope: "registrar" }, attributes: attrs });
    const pending = await db.User.findOne({ where: { role: "alumni", account_status: "pending" }, attributes: attrs });
    assert.ok(admin && employerAdmin && alumni && employer && registrar, "Existing accounts for all five role checks are required.");
    const baseline = await db.MembershipApplication.count();
    const submittedCount = await db.MembershipApplication.count({ where: require("../services/membershipListing").submittedMembershipWhere() });
    await check("/membership/me", null, 401);
    const access = await check("/membership/access", admin, 200); assert.equal(access.can_manage, true); assert.equal(access.can_view, true); assert.equal(access.can_approve, false);
    const list = await check("/membership/admin", admin, 200); assert.ok(Array.isArray(list.applications)); assert.equal(list.total, submittedCount);
    for (const row of list.applications) assert.deepEqual(Object.keys(row).sort(), ["id", "name", "email", "academic_program", "graduation_year", "submitted_at", "application_status"].sort());
    await check("/membership/admin/not-an-id", admin, 400);
    await check("/membership/admin/2147483647", admin, 404);
    await check("/membership/admin/2147483647/document", admin, 404);
    await check("/membership/admin/2147483647/pdf", admin, 404);
    await check("/membership/admin?status=verified", admin, 400);
    await check("/membership/admin?status=pending_review&page=1&page_size=1", admin, 200);
    await check("/membership/admin?search=membership-privacy-check%40example.invalid&status=pending_review&graduation_year=2026", admin, 200);
    const own = await check("/membership/me", alumni, 200); assert.equal(typeof own.completion.submitted, "boolean"); assert.equal(own.prefill.personal_details.tin, undefined);
    await check("/membership/me", employer, 403);
    for (const denied of [registrar, employerAdmin, employer, alumni]) {
        const deniedAccess = await check("/membership/access", denied, 200);
        assert.equal(deniedAccess.can_view, false); assert.equal(deniedAccess.can_manage, false); assert.equal(deniedAccess.can_approve, false);
        for (const path of ["/membership/admin", "/membership/admin/1", "/membership/admin/1/document", "/membership/admin/1/pdf"]) await check(path, denied, 403);
    }
    for (const path of ["/membership/admin", "/membership/admin/1/document", "/membership/admin/1/pdf"]) await check(path, null, 401);
    if (pending) await check("/membership/me", pending, 403);
    if (!own.completion.submitted) await check("/membership/me/submit", alumni, 400, "POST", { personal_details: {}, consent_accepted: false });
    await check("/membership/me/draft", alumni, 400, "PUT", []);
    assert.equal(await db.MembershipApplication.count(), baseline);
    console.log(`${checks} live membership HTTP/auth/routes checks passed. Membership records unchanged.`);
}
run().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => db.sequelize.close());
