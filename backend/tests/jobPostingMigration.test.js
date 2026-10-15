"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Sequelize = require("sequelize");
const migration = require("../migrations/20261014-add-job-posting-details");
const { run, migrationName } = require("../scripts/applyJobPostingMigration");

test("additive migration adds one nullable JSON column and is idempotent", async () => {
    const columns = { id: { type: "INT" }, title: { type: "VARCHAR(255)" } };
    const calls = [];
    const qi = { describeTable: async table => { assert.equal(table, "Jobs"); return columns; }, addColumn: async (table, column, definition) => { calls.push([table, column]); assert.equal(definition.allowNull, true); assert.equal(definition.defaultValue, null); assert.equal(definition.type, Sequelize.JSON); columns[column] = { type: "LONGTEXT", allowNull: true }; } };
    await migration.up(qi, Sequelize); await migration.up(qi, Sequelize);
    assert.deepEqual(calls, [["Jobs", "posting_details"]]); assert.equal(columns.title.type, "VARCHAR(255)");
});
test("migration runner verifies schema and records only successful migration once", async () => {
    const columns = { id: { type: "INT", allowNull: false } }; const ledger = [];
    const qi = { showAllTables: async () => ["Jobs", "SequelizeMeta"], describeTable: async () => ({ ...columns }), addColumn: async () => { columns.posting_details = { type: "LONGTEXT", allowNull: true }; }, bulkInsert: async (table, rows) => { assert.equal(table, "SequelizeMeta"); ledger.push(...rows); } };
    const database = { sequelize: { authenticate: async () => null, getQueryInterface: () => qi, config: { database: "mock_test" }, query: async (_sql, options) => ledger.filter(row => row.name === options.replacements.name) } };
    await run(database); await run(database); assert.deepEqual(ledger, [{ name: migrationName }]);
});
test("runner refuses ledger success when incompatible column exists", async () => {
    let ledgerWritten = false;
    const qi = { showAllTables: async () => ["Jobs", "SequelizeMeta"], describeTable: async () => ({ id: { type: "INT" }, posting_details: { type: "VARCHAR(255)", allowNull: true } }), bulkInsert: async () => { ledgerWritten = true; } };
    const database = { sequelize: { authenticate: async () => null, getQueryInterface: () => qi, config: { database: "mock_test" }, query: async () => [] } };
    await assert.rejects(run(database), /JSON-compatible/); assert.equal(ledgerWritten, false);
});
test("destructive structured-column rollback is disabled", async () => { await assert.rejects(migration.down(), /preserved/); });
