const Sequelize = require("sequelize");
const migration = require("../migrations/20261021-add-alumni-major");
const { guardedApply } = require("./repairMessagingStorage");

async function run(db, args = process.argv.slice(2), report = console.log) {
    const value = flag => { const i = args.indexOf(flag); return i < 0 ? null : args[i + 1]; };
    const apply = args.includes("--apply");
    const database = value("--database"), host = value("--host");
    if (apply && (!database || !host)) throw new Error("--apply requires the reviewed --database and --host.");
    await db.sequelize.authenticate();
    const [identity] = await db.sequelize.query("SELECT DATABASE() AS database_name, VERSION() AS server_version", { type: Sequelize.QueryTypes.SELECT });
    if ((database && database !== identity.database_name) || (host && host !== db.sequelize.config.host)) throw new Error("Database identity mismatch; no changes performed.");
    const plan = await migration.inspect(db.sequelize.getQueryInterface());
    report(JSON.stringify({ mode: apply ? "apply" : "read-only", host: db.sequelize.config.host, ...identity, changes: plan }));
    if (apply && plan.length) await guardedApply(db, identity.database_name, 15, qi => migration.up(qi, Sequelize));
    if (apply) report(JSON.stringify({ remainingChanges: await migration.inspect(db.sequelize.getQueryInterface()) }));
}
if (require.main === module) {
    let db;
    (async () => {
        try {
            db = require("../models");
            if (!["localhost", "127.0.0.1", "::1"].includes(db.sequelize.config.host)) {
                if (!process.env.MIGRATION_DB_CA_FILE) throw new Error("MIGRATION_DB_CA_FILE is required for verified remote TLS.");
                const ssl = { ca: require("node:fs").readFileSync(process.env.MIGRATION_DB_CA_FILE, "utf8"), rejectUnauthorized: true, verifyIdentity: true, minVersion: "TLSv1.2" };
                db.sequelize.options.dialectOptions = { ...db.sequelize.options.dialectOptions, ssl };
                db.sequelize.config.dialectOptions = { ...db.sequelize.config.dialectOptions, ssl };
            }
            await run(db);
        } catch (error) {
            // Connection errors can contain private connection parameters; never print them.
            console.error("Alumni major migration stopped. Review the target, CA certificate, schema and arguments.", { code: /^[A-Z0-9_]{1,64}$/.test(error.original?.code || error.code || "") ? error.original?.code || error.code : null });
            process.exitCode = 1;
        } finally { if (db) await db.sequelize.close(); }
    })();
}
module.exports = { run };
