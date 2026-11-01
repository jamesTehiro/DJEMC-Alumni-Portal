import test from "node:test";
import assert from "node:assert/strict";
import { filterAdminUsers } from "../src/features/settings/utils/adminUserSearch.js";

const employers = [
    { id: 11, name: "Jane Smith", email: "jane@example.test", EmployerProfile: { organization_name: "Mercury Drug Corporation" } },
    { id: 12, name: "FICCO", email: "ficco@gmail.com", EmployerProfile: { organization_name: "FICCO" } },
    { id: 13, name: "Other Employer", email: "other@sample.test" }
];

const alumni = [
    { id: 21, name: "Alex Dela Cruz", email: "alex@gmail.com" },
    { id: 22, name: "Alma Santos", email: "alma@example.test" }
];

test("employer search matches organization and account names case-insensitively", () => {
    assert.deepEqual(filterAdminUsers(employers, "  mErCuRy  ", "employer"), [employers[0]]);
    assert.deepEqual(filterAdminUsers(employers, "fic", "employer"), [employers[1]]);
});

test("employer and alumni search match partial email addresses", () => {
    assert.deepEqual(filterAdminUsers(employers, "gmail.com", "employer"), [employers[1]]);
    assert.deepEqual(filterAdminUsers(alumni, "ALEX@GMAIL", "alumni"), [alumni[0]]);
});

test("alumni search matches partial names and returns no unrelated accounts", () => {
    assert.deepEqual(filterAdminUsers(alumni, "sAnTo", "alumni"), [alumni[1]]);
    assert.deepEqual(filterAdminUsers(alumni, "no match", "alumni"), []);
});

test("cleared or whitespace-only search returns the complete original list", () => {
    assert.equal(filterAdminUsers(employers, "", "employer"), employers);
    assert.equal(filterAdminUsers(alumni, "   ", "alumni"), alumni);
});

test("filtered results retain account objects and stable IDs for row actions", () => {
    const [match] = filterAdminUsers(employers, "ficco", "employer");
    assert.equal(match, employers[1]);
    assert.equal(match.id, 12);
});
