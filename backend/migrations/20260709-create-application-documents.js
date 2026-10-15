"use strict";

const hasTable = async (queryInterface, tableName) => {
    const tables = await queryInterface.showAllTables();
    return tables.some((t) => t.toLowerCase() === tableName.toLowerCase());
};

module.exports = {
    async up(queryInterface, Sequelize) {
        const transaction = await queryInterface.sequelize.transaction();
        try {
            if (!(await hasTable(queryInterface, "ApplicationDocuments"))) {
                await queryInterface.createTable(
                    "ApplicationDocuments",
                    {
                        id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
                        application_id: { type: Sequelize.INTEGER, allowNull: false },
                        requirement_code: { type: Sequelize.STRING(100), allowNull: false },
                        file_path: { type: Sequelize.TEXT, allowNull: false },
                        file_name: { type: Sequelize.STRING(255), allowNull: false },
                        file_size: { type: Sequelize.INTEGER, allowNull: true },
                        mime_type: { type: Sequelize.STRING(100), allowNull: true },
                        review_status: {
                            type: Sequelize.ENUM("pending_review", "approved", "rejected", "needs_revision"),
                            defaultValue: "pending_review"
                        },
                        review_notes: { type: Sequelize.TEXT, allowNull: true },
                        reviewed_by: { type: Sequelize.INTEGER, allowNull: true },
                        reviewed_at: { type: Sequelize.DATE, allowNull: true },
                        original_document_id: { type: Sequelize.INTEGER, allowNull: true },
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

                await queryInterface.addIndex("ApplicationDocuments", ["application_id"], { transaction });
                await queryInterface.addIndex("ApplicationDocuments", ["requirement_code"], { transaction });
                await queryInterface.addIndex("ApplicationDocuments", ["review_status"], { transaction });
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
            if (await hasTable(queryInterface, "ApplicationDocuments")) {
                await queryInterface.dropTable("ApplicationDocuments", { transaction });
            }
            await transaction.commit();
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    }
};
