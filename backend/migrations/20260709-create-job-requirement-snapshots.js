"use strict";

const hasTable = async (queryInterface, tableName) => {
    const tables = await queryInterface.showAllTables();
    return tables.some((t) => t.toLowerCase() === tableName.toLowerCase());
};

module.exports = {
    async up(queryInterface, Sequelize) {
        const transaction = await queryInterface.sequelize.transaction();
        try {
            if (!(await hasTable(queryInterface, "JobRequirementSnapshots"))) {
                await queryInterface.createTable(
                    "JobRequirementSnapshots",
                    {
                        id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
                        application_id: { type: Sequelize.INTEGER, allowNull: false, unique: true },
                        job_id: { type: Sequelize.INTEGER, allowNull: false },
                        version: { type: Sequelize.INTEGER, allowNull: false },
                        snapshot_data: { type: Sequelize.JSON, allowNull: false },
                        created_at: {
                            type: Sequelize.DATE,
                            allowNull: false,
                            defaultValue: Sequelize.literal("CURRENT_TIMESTAMP")
                        }
                    },
                    { transaction }
                );

                await queryInterface.addIndex("JobRequirementSnapshots", ["application_id"], { transaction });
                await queryInterface.addIndex("JobRequirementSnapshots", ["job_id", "version"], { transaction });
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
            if (await hasTable(queryInterface, "JobRequirementSnapshots")) {
                await queryInterface.dropTable("JobRequirementSnapshots", { transaction });
            }
            await transaction.commit();
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    }
};