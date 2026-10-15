"use strict";

const path = require("path");
const Sequelize = require("sequelize");
const db = require("../models");

const run = async () => {
    await db.sequelize.authenticate();
    const queryInterface = db.sequelize.getQueryInterface();
    const migration = require(path.join(__dirname, "..", "migrations", "20261013-create-alumni-profile-update-requests.js"));
    await migration.up(queryInterface, Sequelize);
    const columns = await queryInterface.describeTable("AlumniProfileUpdateRequests");
    const required = ["alumni_user_id", "requested_by", "notification_id", "email_queue_job_id", "status", "request_message", "sent_at", "responded_at", "completed_at"];
    const missing = required.filter((column) => !columns[column]);
    if (missing.length) throw new Error(`AlumniProfileUpdateRequests is missing columns: ${missing.join(", ")}`);
    console.log("Alumni profile update request migration is applied.");
};

run()
    .catch((error) => {
        console.error(`Alumni profile tracking migration failed: ${error.message}`);
        process.exitCode = 1;
    })
    .finally(async () => {
        await db.sequelize.close();
    });
