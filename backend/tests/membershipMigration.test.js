"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Sequelize = require("sequelize");
const migration = require("../migrations/20261014-create-membership-applications");

function fixture(existing = false) {
    const tables = existing ? ["MembershipApplications", "MembershipAdministrators"] : [];
    const indexes = { MembershipApplications: [], MembershipAdministrators: [] };
    const calls = { create: [], addIndex: [], grant: [] };
    const qi = {
        showAllTables: async () => [...tables],
        createTable: async (table, columns) => { calls.create.push({ table, columns }); tables.push(table); indexes[table] = [{ name: "PRIMARY", unique: true, fields: [{ attribute: "id" }] }]; },
        showIndex: async table => indexes[table],
        addIndex: async (table, fields, options) => { calls.addIndex.push({ table, fields, options }); indexes[table].push({ name: options.name, unique: options.unique === true, fields: fields.map(attribute => ({ attribute })) }); },
        dropTable: async () => { throw new Error("Records must never be dropped"); },
        removeIndex: async () => { throw new Error("Existing indexes must never be removed"); },
        sequelize: { query: async sql => { calls.grant.push(sql); assert.ok(indexes.MembershipApplications.some(index => index.unique && index.fields[0].attribute === "alumni_user_id")); assert.ok(indexes.MembershipAdministrators.some(index => index.unique && index.fields[0].attribute === "user_id")); return []; } }
    };
    return { qi, calls, indexes };
}
test("membership migration explicitly creates both unique indexes before the administrator grant", async () => {
    const { qi, calls } = fixture(); await migration.up(qi, Sequelize); assert.equal(calls.create.length, 2);
    assert.deepEqual(calls.addIndex.filter(call => call.options.unique).map(call => [call.table, call.fields[0]]), [["MembershipApplications", "alumni_user_id"], ["MembershipAdministrators", "user_id"]]);
    assert.equal(calls.grant.length, 1); assert.match(calls.grant[0], /NOT EXISTS/); assert.match(calls.grant[0], /u\.account_status = 'verified'/);
});
test("partial migration adds missing uniqueness without replacing tables or foreign-key indexes", async () => {
    const { qi, calls, indexes } = fixture(true); indexes.MembershipApplications.push({ name: "alumni_user_id", unique: false, fields: [{ attribute: "alumni_user_id" }] }); indexes.MembershipAdministrators.push({ name: "user_id", unique: false, fields: [{ attribute: "user_id" }] });
    await migration.up(qi, Sequelize); assert.equal(calls.create.length, 0); assert.equal(calls.addIndex.filter(call => call.options.unique).length, 2);
    assert.ok(indexes.MembershipApplications.some(index => index.name === "alumni_user_id" && !index.unique)); assert.ok(indexes.MembershipAdministrators.some(index => index.name === "user_id" && !index.unique));
});
test("reapplying the membership migration does not duplicate tables or indexes", async () => {
    const { qi, calls } = fixture(); await migration.up(qi, Sequelize); const indexCount = calls.addIndex.length; await migration.up(qi, Sequelize); assert.equal(calls.create.length, 2); assert.equal(calls.addIndex.length, indexCount);
});
test("equivalent unique indexes with different names are accepted", async () => {
    const { qi, calls, indexes } = fixture(true); indexes.MembershipApplications.push({ name: "existing_alumni_unique", unique: true, fields: [{ attribute: "alumni_user_id" }] }); indexes.MembershipAdministrators.push({ name: "existing_admin_unique", unique: true, fields: [{ attribute: "user_id" }] });
    await migration.up(qi, Sequelize); assert.equal(calls.addIndex.filter(call => call.options.unique).length, 0);
});
test("conflicting named indexes fail clearly without removing existing indexes", async () => {
    const { qi, indexes } = fixture(true); indexes.MembershipApplications.push({ name: "membership_application_alumni_uq", unique: false, fields: [{ attribute: "alumni_user_id" }] }); await assert.rejects(() => migration.up(qi, Sequelize), /exists without the required unique constraint/);
});
