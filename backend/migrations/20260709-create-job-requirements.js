"use strict";

const hasTable = async (queryInterface, tableName) => {
    const tables = await queryInterface.showAllTables();
    return tables.some((t) => t.toLowerCase() === tableName.toLowerCase());
};

module.exports = {
    async up(queryInterface, Sequelize) {
        const transaction = await queryInterface.sequelize.transaction();
        try {
            if (!(await hasTable(queryInterface, "JobRequirements"))) {
                await queryInterface.createTable(
                    "JobRequirements",
                    {
                        id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
                        job_id: { type: Sequelize.INTEGER, allowNull: false },
                        version: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
                        group_id: { type: Sequelize.INTEGER, allowNull: true },
                        library_id: { type: Sequelize.INTEGER, allowNull: true },
                        requirement_code: { type: Sequelize.STRING(100), allowNull: false },
                        label: { type: Sequelize.STRING(255), allowNull: false },
                        description: { type: Sequelize.TEXT, allowNull: true },
                        requirement_type: {
                            type: Sequelize.ENUM("document_upload", "information_field"),
                            allowNull: false,
                            defaultValue: "document_upload"
                        },
                        value_type: { type: Sequelize.STRING(50), allowNull: true },
                        value_options: { type: Sequelize.JSON, allowNull: true },
                        required: { type: Sequelize.BOOLEAN, defaultValue: true },
                        is_custom: { type: Sequelize.BOOLEAN, defaultValue: false },
                        condition_enabled: { type: Sequelize.BOOLEAN, defaultValue: false },
                        condition_field: { type: Sequelize.STRING(100), allowNull: true },
                        condition_operator: { type: Sequelize.STRING(20), allowNull: true },
                        condition_value: { type: Sequelize.STRING(500), allowNull: true },
                        allowed_types: { type: Sequelize.STRING(500), allowNull: true },
                        max_file_size: { type: Sequelize.INTEGER, allowNull: true },
                        sort_order: { type: Sequelize.INTEGER, defaultValue: 0 },
                        created_at: {
                            type: Sequelize.DATE,
                            allowNull: false,
                            defaultValue: Sequelize.literal("CURRENT_TIMESTAMP")
                        }
                    },
                    { transaction }
                );

                await queryInterface.addIndex("JobRequirements", ["job_id", "version"], { transaction });
                await queryInterface.addIndex("JobRequirements", ["requirement_code"], { transaction });
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
            if (await hasTable(queryInterface, "JobRequirements")) {
                await queryInterface.dropTable("JobRequirements", { transaction });
            }
            await transaction.commit();
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    }
};