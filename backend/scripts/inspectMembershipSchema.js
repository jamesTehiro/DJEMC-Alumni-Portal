// Read-only deployment inspection. Never prints credentials or submitted personal data.
const db = require("../models");
async function run() {
    await db.sequelize.authenticate();
    const qi = db.sequelize.getQueryInterface();
    const tables = await qi.showAllTables();
    console.log(JSON.stringify({ database: db.sequelize.config.database, host: db.sequelize.config.host, port: db.sequelize.config.port, membership_tables: tables.filter(table => /membership/i.test(String(table))) }));
    console.log(await db.sequelize.query("SELECT VERSION() AS version", { type: db.Sequelize.QueryTypes.SELECT }));
    for (const table of ["Users", "AlumniProfiles", "AlumniRecords"]) console.log(`${table}: ${Object.keys(await qi.describeTable(table)).join(",")}`);
    console.log("Designated membership administrators:", await db.User.findAll({ where: { role: "admin", admin_scope: "employer" }, attributes: ["id", "role", "admin_scope", "account_status"], raw: true }));
    if (tables.some(table => String(table).toLowerCase() === "sequelizemeta")) console.log("Migration ledger:", await db.sequelize.query("SELECT name FROM SequelizeMeta WHERE name LIKE '%membership%'", { type: db.Sequelize.QueryTypes.SELECT }));
    for (const model of [db.User, db.AlumniProfile, db.AlumniRecord, db.Notification, db.EmailQueueJob, db.Resume]) console.log(`${model.tableName}: ${await model.count()}`);
}
run().catch(error => { console.error(error.name); process.exitCode = 1; }).finally(() => db.sequelize.close());
