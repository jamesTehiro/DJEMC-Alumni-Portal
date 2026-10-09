"use strict";

const hasColumn = async (queryInterface, tableName, columnName) => {
    const columns = await queryInterface.describeTable(tableName);
    return Boolean(columns[columnName]);
};

const normalizeTableName = (name) => String(name || "").replace(/[`\[\]"']/g, "");

module.exports = {
    async up(queryInterface, Sequelize) {
        const transaction = await queryInterface.sequelize.transaction();
        try {
            // Sequelize default model table for model name "AlumniProfile" is "AlumniProfiles".
            const tableName = "AlumniProfiles";

            // Guard: only run if the table exists.
            const tables = await queryInterface.showAllTables();
            const exists = tables.some((t) => normalizeTableName(t).toLowerCase() === tableName.toLowerCase());
            if (!exists) {
                await transaction.commit();
                return;
            }

            if (!(await hasColumn(queryInterface, tableName, "employment_status"))) {
                await queryInterface.addColumn(
                    tableName,
                    "employment_status",
                    {
                        type: Sequelize.STRING(30),
                        allowNull: true
                    },
                    { transaction }
                );
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
            const tableName = "AlumniProfiles";
            const tables = await queryInterface.showAllTables();
            const exists = tables.some((t) => normalizeTableName(t).toLowerCase() === tableName.toLowerCase());
            if (!exists) {
                await transaction.commit();
                return;
            }

            if (await hasColumn(queryInterface, tableName, "employment_status")) {
                await queryInterface.removeColumn(tableName, "employment_status", { transaction });
            }

            await transaction.commit();
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    }
};

