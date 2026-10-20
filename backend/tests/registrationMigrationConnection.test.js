const test = require("node:test");
const assert = require("node:assert/strict");
const { createMigrationConnection } = require("../config/registrationMigrationDatabase");
const { run } = require("../scripts/applyRegistrationOtpMigration");

test("migration applies require separate credentials and preserve runtime database settings", async () => {
    const runtime = { DB_HOST: "localhost", DB_PORT: "3306", DB_NAME: "working", DB_USER: "runtime", DB_PASS: "fixture" };
    await assert.rejects(async () => createMigrationConnection(runtime, { apply: true }), /MIGRATION_DB_/);
    const original = { ...runtime };
    const connection = createMigrationConnection(runtime);
    try { assert.equal(connection.config.database, "working"); assert.deepEqual(runtime, original); }
    finally { await connection.close(); }
});
test("remote migration connection enforces certificate verification without connecting", async () => {
    const connection = createMigrationConnection({ MIGRATION_DB_HOST: "staging.example.invalid", MIGRATION_DB_PORT: "12345", MIGRATION_DB_NAME: "otp_staging", MIGRATION_DB_USER: "migration", MIGRATION_DB_PASS: "fixture-password" }, { apply: true });
    try { assert.equal(connection.options.dialectOptions.ssl.rejectUnauthorized, true); assert.equal(connection.config.username, "migration"); }
    finally { await connection.close(); }
});
test("apply refuses unspecified targets and missing production approval before authenticating", async () => {
    let connected = false;
    const db = { sequelize: { authenticate: async () => { connected = true; } } };
    await assert.rejects(run(db, ["--apply"]), /requires --host and --database/);
    await assert.rejects(run(db, ["--apply", "--host", "fixture", "--database", "fixture"]), /requires --environment/);
    await assert.rejects(run(db, ["--apply", "--host", "fixture", "--database", "fixture", "--environment", "production"]), /explicit user approval/);
    assert.equal(connected, false);
});
