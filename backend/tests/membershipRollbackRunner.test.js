"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const db = require("../models");
const { createRollbackTransactionRunner } = require("../scripts/checkMembershipWorkflow");
test.after(async () => db.sequelize.close());

test("rollback check managed callbacks use the enclosing transaction without opening or committing another", async () => {
    const outer = {}; const runner = createRollbackTransactionRunner({}, outer, async () => { throw new Error("A top-level transaction must not open"); });
    assert.equal(await runner(async transaction => transaction), outer);
});
test("rollback check permits only Sequelize savepoints explicitly parented to the enclosing transaction", async () => {
    const sequelize = {}; const outer = {}; const child = { parent: outer }; const options = { transaction: outer };
    const runner = createRollbackTransactionRunner(sequelize, outer, async function (received) { assert.equal(this, sequelize); assert.equal(received, options); return child; });
    assert.equal(await runner(options), child);
});
test("rollback check rejects unmanaged top-level and foreign-parent transactions", async () => {
    const outer = {}; const runner = createRollbackTransactionRunner({}, outer, async () => { throw new Error("Unauthorized transaction attempted"); });
    for (const input of [undefined, null, {}, { transaction: undefined }, { transaction: {} }, { transaction: { parent: outer } }]) await assert.rejects(() => runner(input), /Unmanaged top-level transactions/);
});
