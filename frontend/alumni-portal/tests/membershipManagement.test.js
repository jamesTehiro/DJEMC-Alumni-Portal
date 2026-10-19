import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canOpenMembershipForm, emptyMembershipFilters, isMembershipManagementUser, membershipManagementQuery, membershipRowNumber, membershipStatus, validateMembershipListResponse } from "../src/utils/membershipManagement.js";

test("submitted membership display maps to pending review without changing backend values", () => {
    assert.deepEqual(membershipStatus("submitted"), { label: "Pending Review", tone: "pending" });
    assert.equal(membershipStatus("approved").label, "Approved");
    assert.equal(membershipStatus("for_correction").label, "For Correction");
    assert.equal(membershipStatus("verified").label, "Status unavailable");
});
test("alumni form entry disappears only after database-confirmed submission", () => {
    assert.equal(canOpenMembershipForm(null), false);
    assert.equal(canOpenMembershipForm({ eligible: false, completion: { submitted: false } }), false);
    assert.equal(canOpenMembershipForm({ eligible: true, completion: { submitted: false } }), true);
    assert.equal(canOpenMembershipForm({ eligible: true, completion: { submitted: true } }), false);
});
test("visible row numbers follow pagination, independently of database application IDs", () => {
    assert.equal(membershipRowNumber(1, 10, 0), 1); assert.equal(membershipRowNumber(3, 25, 4), 55);
});
test("all search and filter values are included together and can be cleared", () => {
    const params = new URLSearchParams(membershipManagementQuery({ search: "a+b@example.invalid", status: "pending_review", graduation_year: "2026", submitted_date: "2026-10-14" }, 2, 25));
    assert.equal(params.get("search"), "a+b@example.invalid"); assert.equal(params.get("status"), "pending_review"); assert.equal(params.get("graduation_year"), "2026"); assert.equal(params.get("submitted_date"), "2026-10-14");
    assert.equal(membershipManagementQuery(emptyMembershipFilters(), 1, 10), "page=1&page_size=10");
});
test("list response validation accepts real empty states and rejects malformed results", () => {
    const response = { applications: [], total: 0, summary: { total: 0, pending_review: 0, approved: 0, for_correction: 0 }, filter_options: { graduation_years: [] } };
    assert.equal(validateMembershipListResponse(response), response);
    for (const value of [null, {}, { ...response, applications: null }, { ...response, total: -1 }, { ...response, summary: null }, { ...response, applications: [{ id: "invalid" }] }]) assert.throws(() => validateMembershipListResponse(value));
});
test("management table has the required columns and no application number column", () => {
    const source = readFileSync(new URL("../src/pages/admin/AdminMembershipApplicationsPage.jsx", import.meta.url), "utf8");
    const headers = [...source.matchAll(/<th scope="col">([^<]+)<\/th>/g)].map(match => match[1]);
    assert.deepEqual(headers, ["#", "Name", "Email", "Graduation Year", "Date Submitted", "Status", "Actions"]);
});
test("legacy alumni URL only redirects to the dashboard while preserving the dormant form implementation", () => {
    const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
    assert.match(app, /path="\/membership-application" element=\{<Navigate to="\/dashboard" replace \/>/);
    assert.doesNotMatch(app, /openMembershipApplication/);
    const dashboard = readFileSync(new URL("../src/components/DashboardLayout.jsx", import.meta.url), "utf8");
    assert.doesNotMatch(dashboard, /MembershipFlowProvider|Membership Application/);
    const modal = readFileSync(new URL("../src/components/membership/MembershipApplicationModal.jsx", import.meta.url), "utf8");
    assert.match(modal, /MembershipApplicationForm embedded/);
    const form = readFileSync(new URL("../src/pages/MembershipApplicationPage.jsx", import.meta.url), "utf8");
    assert.match(form, /showSuccess && !embedded/); assert.match(form, /onConfirmedSave\?\.\(result\)/);
});
test("membership management requires the explicit Admin Alumni scope", () => {
    assert.equal(isMembershipManagementUser({ role: "admin", admin_scope: "alumni" }), true);
    for (const user of [null, {}, { role: "admin" }, { role: "admin", admin_scope: "registrar" }, { role: "admin", admin_scope: "employer" }, { role: "alumni", admin_scope: "alumni" }, { role: "employer", admin_scope: "alumni" }]) {
        assert.equal(isMembershipManagementUser(user), false);
    }
});
test("management route belongs to Admin Alumni and legacy staff routes redirect through its guard", () => {
    const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
    assert.match(app, /path="\/admin\/alumni\/membership-applications"\s+element=\{\s+<ProtectedRoute allow=\{isMembershipManagementUser\} redirectTo="\/admin">\s+<AdminMembershipApplicationsPage \/>/);
    for (const scope of ["registrar", "employer"]) {
        const route = `<Route path="/admin/${scope}/membership-applications" element={<Navigate to="/admin/alumni/membership-applications" replace />} />`;
        assert.ok(app.includes(route), `The old ${scope} path must redirect to the protected Admin Alumni path.`);
    }
    assert.equal([...app.matchAll(/<AdminMembershipApplicationsPage/g)].length, 1);
});
test("Admin Alumni hides membership navigation while preserving its guarded route", () => {
    const shell = readFileSync(new URL("../src/components/AdminShell.jsx", import.meta.url), "utf8");
    const menu = shell.slice(shell.indexOf("const itemsByScope"), shell.indexOf("const items ="));
    const alumni = menu.slice(menu.indexOf("alumni: ["), menu.indexOf("employer: ["));
    const employer = menu.slice(menu.indexOf("employer: ["), menu.indexOf("registrar: ["));
    const registrar = menu.slice(menu.indexOf("registrar: ["));
    assert.doesNotMatch(alumni, /Membership Applications/);
    assert.doesNotMatch(employer, /Membership Applications/); assert.doesNotMatch(registrar, /Membership Applications/);
    assert.doesNotMatch(shell, /membership\/access/);
    const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
    assert.match(app, /path="\/admin\/alumni\/membership-applications"/);
    const page = readFileSync(new URL("../src/pages/admin/AdminMembershipApplicationsPage.jsx", import.meta.url), "utf8");
    assert.match(page, /const scope = "alumni"/);
    assert.match(page, /const allowedRole = isMembershipManagementUser\(user\)/);
    assert.match(page, /<Link to="\/">Home<\/Link>.*<Link to="\/admin\/alumni">Admin Alumni<\/Link>.*aria-current="page">Membership Applications/);
    assert.doesNotMatch(page, /authorized Registrar or Admin Employer/);
    assert.match(shell, /aria-label="Admin profile"/);
});
