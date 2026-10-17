"use strict";
const db = require("../models");
const { run } = require("./applyEmployerPermitMigration");
const migration = require("../migrations/20261018-add-employer-permit-documents");
run(db, process.argv.slice(2), migration).catch(error => {
    console.error("Employer permit documents migration failed:", error.original?.code || error.message);
    process.exitCode = 1;
}).finally(() => db.sequelize.close());
