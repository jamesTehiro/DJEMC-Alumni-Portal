"use strict";
const Sequelize = require("sequelize");
const migrationName = "20261014-add-job-posting-details.js";

async function run(database = require("../models")) {
    await database.sequelize.authenticate();
    const queryInterface = database.sequelize.getQueryInterface();
    const tables = await queryInterface.showAllTables();
    if (!tables.some(table => String(table).toLowerCase() === "sequelizemeta")) {
        await queryInterface.createTable("SequelizeMeta", { name: { type: Sequelize.STRING, allowNull: false, primaryKey: true } });
    }
    const applied = await database.sequelize.query("SELECT name FROM SequelizeMeta WHERE name = :name", { replacements: { name: migrationName }, type: Sequelize.QueryTypes.SELECT });
    const before = await queryInterface.describeTable("Jobs");
    if (!applied.length) await require(`../migrations/${migrationName}`).up(queryInterface, Sequelize);
    const after = await queryInterface.describeTable("Jobs");
    if (!after.posting_details || after.posting_details.allowNull !== true) throw new Error("Jobs.posting_details must exist and allow null for older jobs.");
    if (!/JSON|LONGTEXT/i.test(after.posting_details.type)) throw new Error("Jobs.posting_details must use JSON-compatible storage.");
    const removed = Object.keys(before).filter(column => !after[column]);
    if (removed.length) throw new Error(`Unexpected removed Jobs columns: ${removed.join(", ")}`);
    if (!applied.length) await queryInterface.bulkInsert("SequelizeMeta", [{ name: migrationName }]);
    console.log(`Job posting migration ${applied.length ? "already applied and verified" : "applied and verified"}. Database: ${database.sequelize.config.database}. Existing job records preserved.`);
}

if (require.main === module) {
    const database = require("../models");
    run(database).catch(error => { console.error(`Job posting migration failed: ${error.message}`); process.exitCode = 1; }).finally(() => database.sequelize.close());
}
module.exports = { run, migrationName };
