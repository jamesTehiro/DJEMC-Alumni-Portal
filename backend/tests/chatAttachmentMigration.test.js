const test = require("node:test");
const assert = require("node:assert/strict");
const Sequelize = require("sequelize");
const migration = require("../migrations/20261017-expand-chat-attachment-references");
const { run } = require("../scripts/applyChatAttachmentReferenceMigration");

function fixture() {
    const rows = ["messages", "employermessages"].map((table, i) => ({
        table_name: table, column_name: i ? "attachment" : "file_url", data_type: "varchar",
        is_nullable: i ? "NO" : "YES", column_default: null, column_comment: "retained",
        character_set: "utf8mb4", collation: "utf8mb4_unicode_ci", extra: "", maximum_length: 255
    }));
    const sql = [];
    const qi = {
        queryGenerator: { quoteIdentifier: value => `\`${value}\`` },
        showIndex: async () => [],
        sequelize: { escape: value => `'${value}'`, query: async query => {
            if (query.startsWith("SELECT")) return rows;
            sql.push(query);
            rows.find(row => query.includes(`\`${row.table_name}\``)).data_type = "text";
        } }
    };
    return { rows, sql, qi };
}
test("widens both attachment fields, preserves nullability/charset/comment and reruns safely", async () => {
    const f = fixture();
    await migration.up(f.qi, Sequelize);
    assert.equal(f.sql.length, 2);
    assert.match(f.sql[0], /TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT 'retained'/);
    assert.match(f.sql[1], /NOT NULL COMMENT 'retained'/);
    await migration.up(f.qi, Sequelize);
    assert.equal(f.sql.length, 2);
    await assert.rejects(migration.down(), /Refusing to narrow/);
});
test("refuses missing unified table, indexed fields and unexpected defaults before writing", async () => {
    for (const condition of ["missing", "index", "default"]) {
        const f = fixture();
        if (condition === "missing") f.rows.shift();
        if (condition === "index") f.qi.showIndex = async () => [{ fields: [{ attribute: "attachment" }] }];
        if (condition === "default") f.rows[1].column_default = "legacy-default";
        await assert.rejects(migration.up(f.qi, Sequelize));
        assert.equal(f.sql.length, 0);
    }
});
test("deployment runner checks identity and defaults to read-only", async () => {
    const f = fixture();
    const db = { sequelize: { config: { host: "expected-host" }, authenticate: async () => {},
        query: async () => [{ database_name: "expected-db" }], getQueryInterface: () => f.qi } };
    await run(db, []);
    assert.equal(f.sql.length, 0);
    await assert.rejects(run(db, ["--apply"]), /requires/);
    await assert.rejects(run(db, ["--apply", "--host", "wrong", "--database", "expected-db"]), /mismatch/);
    assert.equal(f.sql.length, 0);
    await run(db, ["--apply", "--host", "expected-host", "--database", "expected-db"]);
    assert.equal(f.sql.length, 2);
});
