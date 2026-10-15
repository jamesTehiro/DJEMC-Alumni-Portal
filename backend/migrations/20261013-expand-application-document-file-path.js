"use strict";

const TABLE_NAME = "ApplicationDocuments";
const COLUMN_NAME = "file_path";

const tableExists = async (queryInterface) => {
    const tables = await queryInterface.showAllTables();
    return tables.some((table) => String(typeof table === "object" ? table.tableName : table).toLowerCase() === TABLE_NAME.toLowerCase());
};

module.exports = {
    async up(queryInterface, Sequelize) {
        if (!(await tableExists(queryInterface))) return;
        const columns = await queryInterface.describeTable(TABLE_NAME);
        if (!columns[COLUMN_NAME]) throw new Error(`${TABLE_NAME}.${COLUMN_NAME} is missing.`);
        if (!/\bTEXT\b/i.test(String(columns[COLUMN_NAME].type))) {
            await queryInterface.changeColumn(TABLE_NAME, COLUMN_NAME, {
                type: Sequelize.TEXT,
                allowNull: false
            });
        }
    },

    async down(queryInterface, Sequelize) {
        if (!(await tableExists(queryInterface))) return;
        const columns = await queryInterface.describeTable(TABLE_NAME);
        if (!columns[COLUMN_NAME]) return;
        const [rows] = await queryInterface.sequelize.query(
            `SELECT COUNT(*) AS long_path_count FROM ${TABLE_NAME} WHERE CHAR_LENGTH(${COLUMN_NAME}) > 500`
        );
        if (Number(rows?.[0]?.long_path_count || 0) > 0) {
            throw new Error("Cannot shrink ApplicationDocuments.file_path to VARCHAR(500): existing file references would be truncated.");
        }
        await queryInterface.changeColumn(TABLE_NAME, COLUMN_NAME, {
            type: Sequelize.STRING(500),
            allowNull: false
        });
    }
};
