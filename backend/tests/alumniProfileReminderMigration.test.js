const test = require("node:test");
const assert = require("node:assert/strict");
const Sequelize = require("sequelize");
const migration = require("../migrations/20261103-create-alumni-profile-reminders");
const { run } = require("../scripts/applyAlumniProfileReminderMigration");

function fixture() {
    let exists = false;
    const calls = [], columns = {
        user_id: { type: "INT", primaryKey: true, allowNull: false },
        next_reminder_at: { type: "DATETIME(3)", allowNull: false },
        last_reminded_at: { type: "DATETIME(3)", allowNull: true },
        last_profile_updated_at: { type: "DATETIME(3)", allowNull: true }
    };
    const parents = [{ table_name: "users", engine: "InnoDB" }, { table_name: "notifications", engine: "InnoDB" }];
    const qi = {
        sequelize: { query: async sql => {
            if (sql.includes("TABLE_NAME IN")) return parents;
            if (sql.includes("REFERENTIAL_CONSTRAINTS")) return [{ delete_rule: "CASCADE" }];
            return [{ engine: "InnoDB" }];
        } },
        showAllTables: async () => exists ? [migration.TABLE] : [],
        describeTable: async () => columns,
        showIndex: async () => [{ primary: true, fields: [{ attribute: "user_id" }] }],
        getForeignKeyReferencesForTable: async () => [{ columnName: "user_id", referencedTableName: "users", referencedColumnName: "id" }],
        createTable: async (...args) => { calls.push(args); exists = true; }
    };
    return { qi, calls, columns, parents };
}

test("additive migration creates only the persistent owner clock, with primary-key uniqueness, InnoDB and private owner cascade", async () => {
    const { qi, calls } = fixture();
    assert.deepEqual(await migration.inspect(qi), [{ action: "create", table: migration.TABLE }]);
    await migration.up(qi, Sequelize);
    assert.equal(calls.length, 1);
    const [table, fields, options] = calls[0];
    assert.equal(table, "alumni_profile_reminders"); assert.equal(options.engine, "InnoDB");
    assert.equal(fields.user_id.primaryKey, true); assert.equal(fields.user_id.onDelete, "CASCADE");
    assert.deepEqual(fields.user_id.references, { model: "users", key: "id" });
    assert.deepEqual(Object.keys(fields), ["user_id", "next_reminder_at", "last_reminded_at", "last_profile_updated_at"]);
    // Generic Sequelize DATE.toSql omits precision; MySQL normalization emits it.
    const mysql = new Sequelize.Sequelize("unused", "unused", "unused", { dialect: "mysql", logging: false });
    try { assert.equal(mysql.normalizeDataType(fields.next_reminder_at.type).toSql(), "DATETIME(3)"); }
    finally { await mysql.close(); }
    await migration.up(qi, Sequelize); assert.equal(calls.length, 1, "Re-running performs no additional DDL");
});

test("preflight rejects nontransactional notifications and incompatible existing columns without modifying them", async () => {
    const { qi, calls, columns, parents } = fixture();
    parents[1].engine = "MyISAM";
    await assert.rejects(migration.up(qi, Sequelize), /InnoDB/); assert.equal(calls.length, 0);
    parents[1].engine = "InnoDB"; await migration.up(qi, Sequelize);
    columns.next_reminder_at.allowNull = true;
    await assert.rejects(migration.up(qi, Sequelize), /incompatible reminder column/); assert.equal(calls.length, 1);
});

test("migration runner defaults to read-only and rejects mismatched targets or missing apply arguments", async () => {
    const { qi, calls } = fixture(), reports = [];
    const db = { sequelize: { authenticate: async () => {}, config: { host: "127.0.0.1" }, query: async () => [{ database_name: "isolated_fixture", server_version: "8.4.0" }], getQueryInterface: () => qi } };
    await run(db, [], value => reports.push(JSON.parse(value)));
    assert.equal(reports[0].mode, "read-only"); assert.equal(calls.length, 0);
    await assert.rejects(run(db, ["--apply"]), /requires/);
    await assert.rejects(run(db, ["--database", "different"]), /identity mismatch/);
    await assert.rejects(run(db, ["--host", "different"]), /identity mismatch/);
    assert.equal(calls.length, 0);
});
