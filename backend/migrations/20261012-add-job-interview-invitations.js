"use strict";

const addColumnIfMissing = async (queryInterface, Sequelize, tableName, name, definition) => {
    const columns = await queryInterface.describeTable(tableName);
    if (!columns[name]) await queryInterface.addColumn(tableName, name, definition);
};

module.exports = {
    async up(queryInterface, Sequelize) {
        const jobFields = {
            interview_venue: { type: Sequelize.STRING, allowNull: true },
            interview_place: { type: Sequelize.TEXT, allowNull: true },
            interview_date: { type: Sequelize.DATEONLY, allowNull: true },
            interview_time: { type: Sequelize.STRING, allowNull: true },
            interview_contact_info: { type: Sequelize.STRING, allowNull: true },
            interview_what_to_bring: { type: Sequelize.TEXT, allowNull: true }
        };
        for (const [name, definition] of Object.entries(jobFields)) {
            await addColumnIfMissing(queryInterface, Sequelize, "Jobs", name, definition);
        }

        await addColumnIfMissing(queryInterface, Sequelize, "email_queue_jobs", "dedupe_key", {
            type: Sequelize.STRING(191),
            allowNull: true
        });
        const queueIndexes = await queryInterface.showIndex("email_queue_jobs");
        if (!queueIndexes.some((index) => index.name === "email_queue_jobs_dedupe_key_uq")) {
            await queryInterface.addIndex("email_queue_jobs", ["dedupe_key"], {
                name: "email_queue_jobs_dedupe_key_uq",
                unique: true
            });
        }

        const notificationColumns = await queryInterface.describeTable("Notifications");
        if (notificationColumns.message) {
            await queryInterface.changeColumn("Notifications", "message", {
                type: Sequelize.TEXT,
                allowNull: true
            });
        }
    },

    async down(queryInterface) {
        const queueIndexes = await queryInterface.showIndex("email_queue_jobs");
        if (queueIndexes.some((index) => index.name === "email_queue_jobs_dedupe_key_uq")) {
            await queryInterface.removeIndex("email_queue_jobs", "email_queue_jobs_dedupe_key_uq");
        }
        const queueColumns = await queryInterface.describeTable("email_queue_jobs");
        if (queueColumns.dedupe_key) await queryInterface.removeColumn("email_queue_jobs", "dedupe_key");

        for (const name of [
            "interview_what_to_bring", "interview_contact_info", "interview_time",
            "interview_date", "interview_place", "interview_venue"
        ]) {
            const columns = await queryInterface.describeTable("Jobs");
            if (columns[name]) await queryInterface.removeColumn("Jobs", name);
        }

        // Keep the safer TEXT width when rolling back; narrowing can truncate existing invitations.
    }
};
