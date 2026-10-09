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
            const tableName = "Users";
            const tables = await queryInterface.showAllTables();
            const exists = tables.some((t) => normalizeTableName(t).toLowerCase() === tableName.toLowerCase());
            if (!exists) {
                await transaction.commit();
                return;
            }

            if (!(await hasColumn(queryInterface, tableName, "alumni_record_id"))) {
                await queryInterface.addColumn(
                    tableName,
                    "alumni_record_id",
                    {
                        type: Sequelize.INTEGER,
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
            const tableName = "Users";
            const tables = await queryInterface.showAllTables();
            const exists = tables.some((t) => normalizeTableName(t).toLowerCase() === tableName.toLowerCase());
            if (!exists) {
                await transaction.commit();
                return;
            }

            if (await hasColumn(queryInterface, tableName, "alumni_record_id")) {
                await queryInterface.removeColumn(tableName, "alumni_record_id", { transaction });
            }

            await transaction.commit();
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    }
};
