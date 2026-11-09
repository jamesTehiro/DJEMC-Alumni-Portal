import test from "node:test";
import assert from "node:assert/strict";
import { filterAdminUsers } from "../src/features/settings/utils/adminUserSearch.js";
import { paginateAdminUsers } from "../src/features/settings/utils/adminUserPagination.js";

test("empty, small, exact and multiple-page lists report accurate ranges", () => {
    for (const total of [0, 7, 10, 11, 25, 40]) {
        const users = Array.from({ length: total }, (_, id) => ({ id }));
        const first = paginateAdminUsers(users, 1);
        assert.equal(first.users.length, Math.min(10, total));
        assert.equal(first.start, total ? 1 : 0);
        assert.equal(first.end, Math.min(10, total));
        assert.equal(first.total, total);
        const last = paginateAdminUsers(users, 999);
        assert.equal(last.page, Math.max(1, Math.ceil(total / 10)));
        assert.equal(last.end, total);
        assert.ok(last.users.length <= 10);
        assert.equal(new Set(Array.from({ length: first.pageCount }, (_, index) => paginateAdminUsers(users, index + 1).users).flat().map(user => user.id)).size, total);
    }
});

test("search filters the full list before pagination for names, email and employer organizations", () => {
    const users = Array.from({ length: 25 }, (_, index) => ({ id: index + 1, name: `Person ${index + 1}`,
        email: `member${index + 1}@example.invalid`, EmployerProfile: { organization_name: `Company ${index + 1}` } }));
    for (const role of ["alumni", "employer"]) {
        for (const query of ["person 25", "MEMBER25@"]) {
            const result = paginateAdminUsers(filterAdminUsers(users, query, role), 1);
            assert.equal(result.total, 1); assert.equal(result.users[0], users[24]);
        }
        const result = paginateAdminUsers(filterAdminUsers(users, "member", role), 2);
        assert.equal(result.total, 25); assert.deepEqual(result.users, users.slice(10, 20));
    }
    assert.equal(paginateAdminUsers(filterAdminUsers(users, "company 25", "employer"), 1).users[0], users[24]);
    assert.equal(users.length, 25);
});

test("removing the only user on the last page clamps the view to the preceding page", () => {
    const users = Array.from({ length: 21 }, (_, id) => ({ id }));
    assert.deepEqual(paginateAdminUsers(users, 3).users, [users[20]]);
    const result = paginateAdminUsers(users.slice(0, 20), 3);
    assert.equal(result.page, 2); assert.equal(result.start, 11); assert.equal(result.end, 20);
    assert.equal(result.users.length, 10); assert.equal(result.users[0], users[10]);
});
