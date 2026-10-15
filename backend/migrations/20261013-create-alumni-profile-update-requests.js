"use strict";

const tableExists = async (queryInterface, tableName) => {
    const tables = await queryInterface.showAllTables();
    return tables.some((table) => String(table).toLowerCase() === tableName.toLowerCase());
};

module.exports = {
    async up(queryInterface, Sequelize) {
        if (await tableExists(queryInterface, "AlumniProfileUpdateRequests")) return;

        await queryInterface.createTable("AlumniProfileUpdateRequests", {
            id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false },
            alumni_user_id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                references: { model: "Users", key: "id" },
                onUpdate: "CASCADE",
                onDelete: "CASCADE"
            },
            requested_by: {
                type: Sequelize.INTEGER,
                allowNull: false,
                references: { model: "Users", key: "id" },
                onUpdate: "CASCADE",
                onDelete: "RESTRICT"
            },
            notification_id: {
                type: Sequelize.INTEGER,
                allowNull: true,
                references: { model: "Notifications", key: "id" },
                onUpdate: "CASCADE",
                onDelete: "SET NULL"
            },
            email_queue_job_id: {
                type: Sequelize.INTEGER,
                allowNull: true,
                references: { model: "email_queue_jobs", key: "id" },
                onUpdate: "CASCADE",
                onDelete: "SET NULL"
            },
            status: { type: Sequelize.STRING(30), allowNull: false, defaultValue: "pending" },
            request_message: { type: Sequelize.TEXT, allowNull: false },
            sent_at: { type: Sequelize.DATE, allowNull: true },
            responded_at: { type: Sequelize.DATE, allowNull: true },
            completed_at: { type: Sequelize.DATE, allowNull: true },
            createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
            updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP") }
        });

        await queryInterface.addIndex("AlumniProfileUpdateRequests", ["alumni_user_id", "status"], { name: "alumni_profile_update_requests_user_status_idx" });
        await queryInterface.addIndex("AlumniProfileUpdateRequests", ["requested_by", "createdAt"], { name: "alumni_profile_update_requests_actor_created_idx" });
        await queryInterface.addIndex("AlumniProfileUpdateRequests", ["notification_id"], { name: "alumni_profile_update_requests_notification_uq", unique: true });
        await queryInterface.addIndex("AlumniProfileUpdateRequests", ["email_queue_job_id"], { name: "alumni_profile_update_requests_email_job_uq", unique: true });
    },

    async down(queryInterface) {
        if (await tableExists(queryInterface, "AlumniProfileUpdateRequests")) {
            await queryInterface.dropTable("AlumniProfileUpdateRequests");
        }
    }
};
