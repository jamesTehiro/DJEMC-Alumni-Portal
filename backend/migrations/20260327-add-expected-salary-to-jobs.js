"use strict";

module.exports = {
    async up(queryInterface, Sequelize) {
        const table = await queryInterface.describeTable("Jobs");

        if (!Object.prototype.hasOwnProperty.call(table, "expected_salary")) {
            await queryInterface.addColumn("Jobs", "expected_salary", {
                type: Sequelize.STRING,
                allowNull: true
            });
        }
    },

    async down(queryInterface) {
        const table = await queryInterface.describeTable("Jobs");

        if (Object.prototype.hasOwnProperty.call(table, "expected_salary")) {
            await queryInterface.removeColumn("Jobs", "expected_salary");
        }
    }
};
