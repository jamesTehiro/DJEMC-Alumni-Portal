"use strict";

module.exports = {
    async up(queryInterface, Sequelize) {
        for (const tableName of ["Messages", "EmployerMessages"]) {
            const columns = await queryInterface.describeTable(tableName);
            if (!columns.file_size) {
                await queryInterface.addColumn(tableName, "file_size", {
                    type: Sequelize.INTEGER,
                    allowNull: true
                });
            }
        }
    },

    async down(queryInterface) {
        for (const tableName of ["EmployerMessages", "Messages"]) {
            const columns = await queryInterface.describeTable(tableName);
            if (columns.file_size) await queryInterface.removeColumn(tableName, "file_size");
        }
    }
};
