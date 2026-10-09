"use strict";

module.exports = {
    async up(queryInterface, Sequelize) {
        const table = await queryInterface.describeTable("EmployerMessages");
        if (!table.file_name) await queryInterface.addColumn("EmployerMessages", "file_name", { type: Sequelize.STRING, allowNull: true });
        if (!table.file_mime) await queryInterface.addColumn("EmployerMessages", "file_mime", { type: Sequelize.STRING, allowNull: true });
    },

    async down(queryInterface) {
        const table = await queryInterface.describeTable("EmployerMessages");
        if (table.file_mime) await queryInterface.removeColumn("EmployerMessages", "file_mime");
        if (table.file_name) await queryInterface.removeColumn("EmployerMessages", "file_name");
    }
};
