"use strict";

const hasTable = async (queryInterface, tableName) => {
    const tables = await queryInterface.showAllTables();
    return tables.some((t) => t.toLowerCase() === tableName.toLowerCase());
};

module.exports = {
    async up(queryInterface, Sequelize) {
        const transaction = await queryInterface.sequelize.transaction();
        try {
            if (!(await hasTable(queryInterface, "RequirementGroups"))) {
                await queryInterface.createTable(
                    "RequirementGroups",
                    {
                        id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
                        job_id: { type: Sequelize.INTEGER, allowNull: false },
                        version: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
                        group_label: { type: Sequelize.STRING(255), allowNull: false },
                        sort_order: { type: Sequelize.INTEGER, defaultValue: 0 },
                        created_at: {
                            type: Sequelize.DATE,
                            allowNull: false,
                            defaultValue: Sequelize.literal("CURRENT_TIMESTAMP")
                        }
                    },
                    { transaction }
                );

                await queryInterface.addIndex("RequirementGroups", ["job_id", "version"], { transaction });
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
            if (await hasTable(queryInterface, "RequirementGroups")) {
                await queryInterface.dropTable("RequirementGroups", { transaction });
            }
            await transaction.commit();
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    }
};