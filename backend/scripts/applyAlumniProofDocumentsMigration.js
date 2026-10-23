"use strict";

const fs = require("node:fs");
const path = require("node:path");
const Sequelize = require("sequelize");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const db = require("../models");
const migration = require("../migrations/20261022-add-alumni-proof-documents");
const { guardedApply } = require("./repairMessagingStorage");

async function run(args = process.argv.slice(2), report = console.log, env = process.env) {
    const parsed = {};
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === "--apply") {
            if (parsed.apply) throw new Error("Duplicate --apply argument.");
            parsed.apply = true;
        } else if (arg === "--database" || arg === "--host") {
            if (parsed[arg]) throw new Error(`Duplicate ${arg} argument.`);
            if (!args[i + 1] || args[i + 1].startsWith("--")) throw new Error(`${arg} requires a value.`);
            parsed[arg] = args[++i];
        } else {
            throw new Error("Unsupported arguments. Use optional --database NAME --host HOST and --apply only after review.");
        }
    }
    const apply = parsed.apply === true;
    const database = parsed["--database"] || null;
    const host = parsed["--host"] || null;
    if (apply && (!database || !host)) {
        throw new Error("--apply requires explicit --database and --host arguments.");
    }

    const sequelize = db.sequelize;
    try {
        const targetHost = sequelize.config.host;
        if (!/^(localhost|127\.0\.0\.1|::1)$/i.test(targetHost)) {
            const caFile = env.MIGRATION_DB_CA_FILE || env.DB_CA_FILE;
            if (!caFile || !fs.existsSync(caFile)) throw new Error("A readable MIGRATION_DB_CA_FILE (or DB_CA_FILE) is required for verified remote TLS.");
            const ssl = { ca: fs.readFileSync(caFile, "utf8"), rejectUnauthorized: true, verifyIdentity: true, minVersion: "TLSv1.2" };
            sequelize.options.dialectOptions = { ...sequelize.options.dialectOptions, ssl };
            sequelize.config.dialectOptions = { ...sequelize.config.dialectOptions, ssl };
        }
        await sequelize.authenticate();
        const [identity] = await sequelize.query("SELECT DATABASE() AS database_name, VERSION() AS server_version", { type: Sequelize.QueryTypes.SELECT });
        if ((database && database !== identity.database_name) || (host && host !== targetHost)) {
            throw new Error("Database identity mismatch; no changes performed.");
        }

        const queryInterface = sequelize.getQueryInterface();
        const current = await migration.readSchema(queryInterface);
        const changes = await migration.inspect(queryInterface);
        report(JSON.stringify({ mode: apply ? "apply" : "read-only", host: targetHost, ...identity, current, changes }));
        if (apply && changes.length) {
            await guardedApply(db, identity.database_name, 15, qi => migration.up(qi, Sequelize));
            const remainingChanges = await migration.inspect(queryInterface);
            report(JSON.stringify({ remainingChanges }));
            if (remainingChanges.length) throw new Error("Schema verification failed after migration.");
        }
        return changes;
    } finally {
        await sequelize.close();
    }
}

if (require.main === module) {
    run().catch(error => {
        // Keep credentials, connection URLs and SQL details out of logs.
        const code = error.original?.code || error.code || null;
        console.error("Alumni proof documents migration stopped. No production changes are made unless --apply, --database and --host are supplied.", {
            code: /^[A-Z0-9_]{1,64}$/.test(code || "") ? code : null,
            message: error.message
        });
        process.exitCode = 1;
    });
}

module.exports = { run };
