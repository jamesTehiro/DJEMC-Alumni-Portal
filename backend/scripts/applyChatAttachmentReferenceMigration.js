"use strict";
const Sequelize = require("sequelize");
const migration = require("../migrations/20261017-expand-chat-attachment-references");
async function run(db, args = process.argv.slice(2)) {
    const apply = args.includes("--apply");
    const value = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
    const database = value("--database"), host = value("--host");
    if (apply && (!database || !host)) throw new Error("--apply requires --database and --host.");
    await db.sequelize.authenticate();
    const [identity] = await db.sequelize.query("SELECT DATABASE() AS database_name", { type: Sequelize.QueryTypes.SELECT });
    if ((database && identity.database_name !== database) || (host && db.sequelize.config.host !== host)) throw new Error("Database/host identity mismatch; no changes performed.");
    console.log(JSON.stringify({ mode: apply ? "apply" : "check-only", database: identity.database_name }));
    const qi = db.sequelize.getQueryInterface();
    console.log(JSON.stringify(await migration.inspect(qi, Sequelize)));
    if (apply) {
        await migration.up(qi, Sequelize);
        console.log("Attachment reference migration applied and verified; existing rows preserved.");
        console.log(JSON.stringify(await migration.inspect(qi, Sequelize)));
    }
}
if (require.main === module) {
    const db = require("../models");
    run(db).catch(error => {
        console.error("Chat attachment migration failed:", error.original?.code || error.message);
        process.exitCode = 1;
    }).finally(() => db.sequelize.close());
}
module.exports = { run };
