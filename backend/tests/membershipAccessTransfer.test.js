"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const migration = require("../migrations/20261014-transfer-membership-access-to-admin-alumni");

function fixture(failGrant = false) {
    const users = [
        { id: 1, role: "admin", admin_scope: "registrar", account_status: "verified" },
        { id: 2, role: "admin", admin_scope: "employer", account_status: "verified" },
        { id: 3, role: "admin", admin_scope: "alumni", account_status: "verified" },
        { id: 4, role: "admin", admin_scope: "alumni", account_status: "pending" },
        { id: 5, role: "alumni", account_status: "verified" },
        { id: 6, role: "admin", admin_scope: "alumni", account_status: "verified" }
    ];
    let grants = [{ user_id: 1, revoked_at: null }, { user_id: 2, revoked_at: null }, { user_id: 6, revoked_at: "previous revocation" }];
    const transaction = {};
    const calls = [];
    const qi = { sequelize: {
        transaction: async action => {
            const before = structuredClone(grants);
            try { await action(transaction); } catch (error) { grants = before; throw error; }
        },
        query: async (sql, options) => {
            assert.equal(options.transaction, transaction); calls.push(sql);
            assert.ok(!/DELETE|DROP|TRUNCATE|MembershipApplications|AlumniProfiles|AlumniRecords/i.test(sql));
            if (sql.startsWith("UPDATE")) {
                assert.match(sql, /m\.revoked_at IS NULL/);
                assert.match(sql, /u\.role = 'admin'/);
                assert.match(sql, /u\.admin_scope IN \('registrar', 'employer'\)/);
                for (const grant of grants) {
                    const user = users.find(user => user.id === grant.user_id);
                    if (grant.revoked_at === null && user.role === "admin" && ["registrar", "employer"].includes(user.admin_scope)) grant.revoked_at = "transfer timestamp";
                }
            } else {
                assert.match(sql, /u\.admin_scope = 'alumni'/);
                assert.match(sql, /u\.account_status = 'verified'/);
                assert.match(sql, /NOT EXISTS/);
                if (failGrant) throw new Error("Grant failed");
                for (const user of users) if (user.role === "admin" && user.admin_scope === "alumni" && user.account_status === "verified" && !grants.some(grant => grant.user_id === user.id)) grants.push({ user_id: user.id, revoked_at: null });
            }
        }
    } };
    return { qi, calls, grants: () => grants };
}

test("transfer revokes former scope grants and designates verified Admin Alumni only", async () => {
    const context = fixture(); await migration.up(context.qi);
    assert.deepEqual(context.grants().filter(grant => grant.revoked_at === null).map(grant => grant.user_id), [3]);
    assert.equal(context.grants().length, 4, "old grant history is retained");
    assert.equal(context.grants().find(grant => grant.user_id === 6).revoked_at, "previous revocation");
});

test("repeating the transfer preserves grant IDs/counts and previous revocations", async () => {
    const context = fixture(); await migration.up(context.qi); const before = structuredClone(context.grants());
    await migration.up(context.qi); assert.deepEqual(context.grants(), before);
});

test("failed transfer rolls back permission updates atomically", async () => {
    const context = fixture(true); const before = structuredClone(context.grants());
    await assert.rejects(() => migration.up(context.qi), /Grant failed/); assert.deepEqual(context.grants(), before);
});

test("automatic rollback cannot restore former management roles", async () => {
    await assert.rejects(() => migration.down(), /must not restore access/);
});
