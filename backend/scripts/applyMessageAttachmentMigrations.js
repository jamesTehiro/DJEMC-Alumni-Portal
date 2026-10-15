"use strict";

const path = require("path");
const Sequelize = require("sequelize");
const db = require("../models");

const migrations = [
    "20261009-add-employer-message-file-metadata.js",
    "20261011-add-message-file-sizes.js"
];

const requiredColumnsByTable = {
    Messages: ["file_name", "file_mime", "file_size"],
    EmployerMessages: ["file_name", "file_mime", "file_size"]
};

const run = async () => {
    const queryInterface = db.sequelize.getQueryInterface();
    await db.sequelize.authenticate();

    for (const migrationFile of migrations) {
        const migrationPath = path.join(__dirname, "..", "migrations", migrationFile);
        const migration = require(migrationPath);
        await migration.up(queryInterface, Sequelize);
        console.log(`Verified migration: ${migrationFile}`);
    }

    for (const [tableName, requiredColumns] of Object.entries(requiredColumnsByTable)) {
        const columns = await queryInterface.describeTable(tableName);
        const missingColumns = requiredColumns.filter((column) => !columns[column]);
        if (missingColumns.length) {
            throw new Error(`${tableName} is still missing: ${missingColumns.join(", ")}`);
        }
        console.log(`${tableName}: attachment metadata columns are present.`);
    }
};

run()
    .catch((error) => {
        console.error(`Message attachment migration failed: ${error.message}`);
        process.exitCode = 1;
    })
    .finally(async () => {
        await db.sequelize.close();
    });
