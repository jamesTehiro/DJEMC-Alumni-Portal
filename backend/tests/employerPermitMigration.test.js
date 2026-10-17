const test = require("node:test");
const assert = require("node:assert/strict");
const Sequelize = require("sequelize");
const migration = require("../migrations/20261017-expand-employer-permit-reference");
const { run } = require("../scripts/applyEmployerPermitMigration");
function fixture() {
    const row = { table_name: "employerprofiles", column_name: "business_permit_path", data_type: "varchar", is_nullable: "YES", column_default: null, column_comment: "", character_set: "utf8mb4", collation: "utf8mb4_general_ci", extra: "", maximum_length: 255 };
    const changes = [];
    const qi = { queryGenerator: { quoteIdentifier: value => `\`${value}\`` }, showIndex: async () => [], sequelize: { escape: () => "''", query: async sql => {
        if (sql.startsWith("SELECT")) return [row];
        changes.push(sql); row.data_type = "text";
    } } };
    return { row, changes, qi };
}
test("permit migration widens only its column and is idempotent without changing rows", async () => {
    const f = fixture(); await migration.up(f.qi,Sequelize); await migration.up(f.qi,Sequelize);
    assert.equal(f.changes.length,1);
    assert.equal(f.changes[0], "ALTER TABLE `employerprofiles` MODIFY COLUMN `business_permit_path` TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL COMMENT ''");
    await assert.rejects(migration.down(),/Refusing/);
});
test("permit migration refuses unexpected constraints and wrong deployment identity", async () => {
    for (const value of ["default", "index"]) {
        const f = fixture();
        if (value === "default") f.row.column_default = "do-not-change";
        else f.qi.showIndex = async () => [{ fields: [{ attribute: "business_permit_path" }] }];
        await assert.rejects(migration.up(f.qi,Sequelize)); assert.equal(f.changes.length,0);
    }
    const f = fixture();
    const db = { sequelize: { config:{host:"reviewed-host"}, authenticate:async()=>{}, query:async()=>[{database_name:"reviewed-db"}], getQueryInterface:()=>f.qi } };
    await run(db,[]); assert.equal(f.changes.length,0);
    await assert.rejects(run(db,["--apply","--database","wrong","--host","reviewed-host"]),/mismatch/);
    await assert.rejects(run(db,["--apply"]),/requires/);
    assert.equal(f.changes.length,0);
});
