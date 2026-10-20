"use strict";
const Sequelize = require("sequelize");
const migration = require("../migrations/20261019-add-registration-gmail-otp");
async function run(db, args = process.argv.slice(2)) {
    const apply = args.includes("--apply");
    const value = flag => { const i = args.indexOf(flag); return i < 0 ? null : args[i + 1]; };
    const expectedHost = value("--host");
    const expectedDatabase = value("--database");
    if (apply && (!expectedHost || !expectedDatabase)) throw new Error("--apply requires --host and --database identifying the reviewed deployment.");
    const environment = value("--environment");
    if (apply && !["local-test", "staging", "production"].includes(environment)) throw new Error("--apply requires --environment local-test, staging, or production, identifying the confirmed target.");
    if (apply && environment === "production" && !args.includes("--production-approved")) throw new Error("Production requires separate explicit user approval and --production-approved. A CLI flag alone is not user authorization.");
    await db.sequelize.authenticate();
    const [identity] = await db.sequelize.query("SELECT DATABASE() AS database_name, VERSION() AS version", { type: Sequelize.QueryTypes.SELECT });
    if ((expectedHost && db.sequelize.config.host !== expectedHost) || (expectedDatabase && identity.database_name !== expectedDatabase)) throw new Error("Database identity mismatch; no schema changes applied.");
    const qi = db.sequelize.getQueryInterface();
    console.log(JSON.stringify({ mode: apply ? "apply" : "read-only", environment: environment || "unconfirmed", version: identity.version,
        configuredDatabaseMatches: identity.database_name === db.sequelize.config.database,
        aivenHost: /aivencloud/i.test(db.sequelize.config.host), schema: await migration.inspect(qi, Sequelize) }));
    if (apply) {
        await migration.up(qi, Sequelize);
        console.log("Registration OTP migration applied and verified. Existing records preserved.");
    } else console.log("No changes applied. Review schema and canonical duplicate count before --apply --host <host> --database <name>.");
}
if (require.main === module) {
    require("dotenv").config({ path: require("path").join(__dirname, "..", ".env"), quiet: true });
    let sequelize;
    Promise.resolve().then(() => {
        sequelize = require("../config/registrationMigrationDatabase").createMigrationConnection(process.env, { apply: process.argv.includes("--apply") });
        return run({ sequelize });
    }).catch(error => { console.error("Registration OTP migration failed:", error.original?.code || error.name,
        error.original ? "Database operation failed; review privately without exposing SQL or credentials." : error.message); process.exitCode = 1; }).finally(() => sequelize?.close());
}
module.exports = { run };
