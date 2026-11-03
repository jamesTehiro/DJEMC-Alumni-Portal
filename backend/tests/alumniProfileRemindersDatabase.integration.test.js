const test = require("node:test");
const assert = require("node:assert/strict");
const { Sequelize, DataTypes, QueryTypes } = require("sequelize");
const migration = require("../migrations/20261103-create-alumni-profile-reminders");
const { createReminders, INTERVAL_MS } = require("../services/alumniProfileReminders");

// Explicit opt-in only. Ignore application .env files. Create a new loopback
// fixture schema, never reuse, alter or delete an existing database.
test("isolated MySQL 8.4: reminder migration, owner locks, rollback and dismiss persistence", {
    skip: process.env.RUN_ALUMNI_REMINDER_DATABASE_TESTS !== "true"
}, async () => {
    const host = process.env.ALUMNI_REMINDER_TEST_HOST || "127.0.0.1";
    assert.ok(["localhost", "127.0.0.1", "::1"].includes(host));
    assert.notEqual(process.env.NODE_ENV, "production");
    const username = process.env.ALUMNI_REMINDER_TEST_USER || "root";
    const password = process.env.ALUMNI_REMINDER_TEST_PASSWORD || "";
    const options = { host, port: Number(process.env.ALUMNI_REMINDER_TEST_PORT || 3311), dialect: "mysql", logging: false };
    const admin = new Sequelize("mysql", username, password, options);
    let sql;
    try {
        const [server] = await admin.query("SELECT VERSION() AS version", { type: QueryTypes.SELECT });
        assert.match(server.version, /^8\.4\./, "This acceptance harness requires isolated MySQL 8.4");
        const name = `djemc_reminder_${process.pid}_${Date.now()}_test`;
        assert.match(name, /^djemc_reminder_\d+_\d+_test$/);
        await admin.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4`);
        sql = new Sequelize(name, username, password, { ...options, pool: { max: 8, min: 0, idle: 1000 } });
        const db = { sequelize: sql };
        for (const model of ["User", "AlumniProfile", "Notification", "AlumniProfileReminder"]) db[model] = require(`../models/${model}`)(sql, DataTypes);
        const qi = sql.getQueryInterface();
        for (const model of ["User", "AlumniProfile", "Notification"]) await qi.createTable(db[model].getTableName(), db[model].rawAttributes, { engine: "InnoDB" });
        let now = new Date("2026-11-03T00:00:00Z");
        const old = new Date(now.getTime() - INTERVAL_MS);
        await db.User.bulkCreate(["alumni", "employer", "admin"].map((role, index) => ({ id: index + 1, name: "Fixture", email: `${role}@example.invalid`, role, account_status: "verified", createdAt: old, updatedAt: old })));
        await db.AlumniProfile.create({ user_id: 1, updatedAt: old });
        const usersBefore = await db.User.findAll({ raw: true });
        await migration.up(qi, DataTypes); await migration.up(qi, DataTypes);
        assert.deepEqual(await db.User.findAll({ raw: true }), usersBefore);
        assert.deepEqual(await migration.inspect(qi), []);
        const make = () => createReminders({ db, clock: async () => now });
        const results = await Promise.all(Array.from({ length: 8 }, () => make().runOnce()));
        assert.equal(results.reduce((a, b) => a + b), 1);
        assert.equal(await db.Notification.count(), 1); assert.equal(await db.AlumniProfileReminder.count(), 1);
        // Dismiss only this fixture reminder. Its clock survives a new service.
        await db.Notification.destroy({ where: { userId: 1, type: "profile_update_reminder" } });
        assert.equal(await make().runOnce(), 0);
        now = new Date(now.getTime() + INTERVAL_MS);
        assert.equal(await make().runOnce(), 1);
        // A late persistence error must roll back the inserted notification too.
        now = new Date(now.getTime() + INTERVAL_MS);
        const update = db.AlumniProfileReminder.prototype.update;
        db.AlumniProfileReminder.prototype.update = async () => { throw new Error("Fixture failure"); };
        try { await assert.rejects(make().runOnce(), /Fixture failure/); }
        finally { db.AlumniProfileReminder.prototype.update = update; }
        assert.equal(await db.Notification.count(), 1);
        assert.equal(await make().runOnce(), 1);
        now = new Date(now.getTime() + 86400000);
        await sql.transaction(async transaction => {
            await db.User.findByPk(1, { transaction, lock: transaction.LOCK.UPDATE });
            await make().resetAfterProfileSave(1, transaction);
        });
        now = new Date(now.getTime() + INTERVAL_MS - 1);
        assert.equal(await make().runOnce(), 0);
        now = new Date(now.getTime() + 1); assert.equal(await make().runOnce(), 1);
    } finally { await sql?.close(); await admin.close(); }
});
