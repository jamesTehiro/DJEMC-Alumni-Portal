"use strict";
const Sequelize = require("sequelize");
const db = require("../models");
const migrationName = "20261014-create-membership-applications.js";

async function run() {
    await db.sequelize.authenticate();
    const qi = db.sequelize.getQueryInterface();
    const tables = await qi.showAllTables();
    if (!tables.some(table => String(table).toLowerCase() === "sequelizemeta")) {
        await qi.createTable("SequelizeMeta", { name: { type: Sequelize.STRING, allowNull: false, primaryKey: true } });
    }
    const applied = await db.sequelize.query("SELECT name FROM SequelizeMeta WHERE name = :name", { replacements: { name: migrationName }, type: Sequelize.QueryTypes.SELECT });
    if (!applied.length) {
        await require(`../migrations/${migrationName}`).up(qi, Sequelize);
    }
    for (const [table, columns] of Object.entries({
        MembershipApplications: ["alumni_user_id", "personal_details", "educational_attainment", "work_experience", "training_seminars", "community_involvement", "awards_citations", "options", "applicant_name", "academic_program", "graduation_year", "consent_accepted", "consent_accepted_at", "consent_text", "consent_version", "application_status", "submitted_at", "profile_completed_at", "created_at", "updated_at"],
        MembershipAdministrators: ["user_id", "granted_by", "grant_reason", "revoked_at", "created_at", "updated_at"]
    })) {
        const existing = await qi.describeTable(table);
        const missing = columns.filter(column => !existing[column]);
        if (missing.length) throw new Error(`${table} is missing required columns: ${missing.join(", ")}`);
    }
    const indexes = await qi.showIndex("MembershipApplications");
    if (!indexes.some(index => index.unique && index.fields.length === 1 && index.fields[0].attribute === "alumni_user_id")) throw new Error("MembershipApplications requires a unique alumni_user_id index.");
    const administratorIndexes = await qi.showIndex("MembershipAdministrators");
    if (!administratorIndexes.some(index => index.unique && index.fields.length === 1 && index.fields[0].attribute === "user_id")) throw new Error("MembershipAdministrators requires a unique user_id index.");
    if (!applied.length) await qi.bulkInsert("SequelizeMeta", [{ name: migrationName }]);
    const registrarMigration = "20261014-grant-registrar-membership-access.js";
    const registrarApplied = await db.sequelize.query("SELECT name FROM SequelizeMeta WHERE name = :name", { replacements: { name: registrarMigration }, type: Sequelize.QueryTypes.SELECT });
    if (!registrarApplied.length) {
        await require(`../migrations/${registrarMigration}`).up(qi, Sequelize);
        await qi.bulkInsert("SequelizeMeta", [{ name: registrarMigration }]);
    }
    const transferMigration = "20261014-transfer-membership-access-to-admin-alumni.js";
    const transferApplied = await db.sequelize.query("SELECT name FROM SequelizeMeta WHERE name = :name", { replacements: { name: transferMigration }, type: Sequelize.QueryTypes.SELECT });
    if (!transferApplied.length) {
        await require(`../migrations/${transferMigration}`).up(qi, Sequelize);
        await qi.bulkInsert("SequelizeMeta", [{ name: transferMigration }]);
    }
    console.log(`Membership migration ${applied.length ? "already applied and verified" : "applied and verified"}. Database: ${db.sequelize.config.database}. Existing records were preserved.`);
    console.log(`Admin Alumni membership-access transfer ${transferApplied.length ? "already applied" : "applied"}. Former Registrar and Admin Employer access is disabled.`);
}

if (require.main === module) run().catch(error => { console.error(`Membership migration failed: ${error.message}`); process.exitCode = 1; }).finally(() => db.sequelize.close());
module.exports = { run };
