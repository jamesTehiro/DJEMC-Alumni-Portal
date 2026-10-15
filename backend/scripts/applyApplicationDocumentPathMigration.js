"use strict";

const path = require("path");
const Sequelize = require("sequelize");
const db = require("../models");
const { isStoredFileReference } = require("../services/objectStorage");

const run = async () => {
    await db.sequelize.authenticate();
    const queryInterface = db.sequelize.getQueryInterface();
    const migrationPath = path.join(__dirname, "..", "migrations", "20261013-expand-application-document-file-path.js");
    await require(migrationPath).up(queryInterface, Sequelize);

    const columns = await queryInterface.describeTable("ApplicationDocuments");
    if (!/\bTEXT\b/i.test(String(columns.file_path?.type || ""))) {
        throw new Error("ApplicationDocuments.file_path is not TEXT after migration.");
    }

    const documents = await db.ApplicationDocument.findAll({ attributes: ["file_path"], raw: true });
    const recoverableCount = documents.filter((document) => isStoredFileReference(document.file_path)).length;
    console.log(`ApplicationDocuments.file_path is TEXT. ${recoverableCount}/${documents.length} stored references are readable.`);
    if (recoverableCount < documents.length) {
        console.warn(`${documents.length - recoverableCount} file reference(s) need recovery from the storage provider.`);
    }
};

run()
    .catch((error) => {
        console.error(`Application document path migration failed: ${error.message}`);
        process.exitCode = 1;
    })
    .finally(async () => {
        await db.sequelize.close();
    });
