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
            const tableName = "AlumniProfiles";
            const tables = await queryInterface.showAllTables();
            const exists = tables.some((table) => normalizeTableName(table).toLowerCase() === tableName.toLowerCase());

            if (!exists) {
                await transaction.commit();
                return;
            }

            if (!(await hasColumn(queryInterface, tableName, "proof_document_path"))) {
                await queryInterface.addColumn(
                    tableName,
                    "proof_document_path",
                    {
                        type: Sequelize.TEXT,
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
            const exists = tables.some((table) => normalizeTableName(table).toLowerCase() === tableName.toLowerCase());

            if (!exists) {
                await transaction.commit();
                return;
            }

            if (await hasColumn(queryInterface, tableName, "proof_document_path")) {
                await queryInterface.removeColumn(tableName, "proof_document_path", { transaction });
            }

            await transaction.commit();
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    }
};
