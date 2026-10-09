"use strict";

const hasTable = async (queryInterface, tableName) => {
    const tables = await queryInterface.showAllTables();
    return tables.some((t) => t.toLowerCase() === tableName.toLowerCase());
};

module.exports = {
    async up(queryInterface, Sequelize) {
        const transaction = await queryInterface.sequelize.transaction();
        try {
            if (!(await hasTable(queryInterface, "ApplicationResponses"))) {
                await queryInterface.createTable(
                    "ApplicationResponses",
                    {
                        id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
                        application_id: { type: Sequelize.INTEGER, allowNull: false },
                        requirement_code: { type: Sequelize.STRING(100), allowNull: false },
                        response_value: { type: Sequelize.TEXT, allowNull: false },
                        review_status: {
                            type: Sequelize.ENUM("pending_review", "approved", "rejected", "needs_revision"),
                            defaultValue: "pending_review"
                        },
                        review_notes: { type: Sequelize.TEXT, allowNull: true },
                        reviewed_by: { type: Sequelize.INTEGER, allowNull: true },
                        reviewed_at: { type: Sequelize.DATE, allowNull: true },
                        version: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
                        created_at: {
                            type: Sequelize.DATE,
                            allowNull: false,
                            defaultValue: Sequelize.literal("CURRENT_TIMESTAMP")
                        },
                        updated_at: {
                            type: Sequelize.DATE,
                            allowNull: false,
                            defaultValue: Sequelize.literal("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP")
                        }
                    },
                    { transaction }
                );

                await queryInterface.addIndex("ApplicationResponses", ["application_id"], { transaction });
                await queryInterface.addIndex("ApplicationResponses", ["requirement_code"], { transaction });
            }
            await transaction.commit();
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    },

    async down(queryInterface) {
        const transaction = await queryInterface.sequelize.transaction();
        try {
            if (await hasTable(queryInterface, "ApplicationResponses")) {
                await queryInterface.dropTable("ApplicationResponses", { transaction });
            }
            await transaction.commit();
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    }
};