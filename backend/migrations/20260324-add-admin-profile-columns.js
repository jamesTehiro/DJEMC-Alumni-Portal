"use strict";

module.exports = {
    async up(queryInterface, Sequelize) {
        const table = await queryInterface.describeTable("Users");

        if (!Object.prototype.hasOwnProperty.call(table, "admin_department")) {
            await queryInterface.addColumn("Users", "admin_department", {
                type: Sequelize.STRING,
                allowNull: true
            });
        }

        if (!Object.prototype.hasOwnProperty.call(table, "admin_avatar_url")) {
            await queryInterface.addColumn("Users", "admin_avatar_url", {
                type: Sequelize.TEXT("long"),
                allowNull: true
            });
        }
    },

    async down(queryInterface) {
        const table = await queryInterface.describeTable("Users");

        if (Object.prototype.hasOwnProperty.call(table, "admin_avatar_url")) {
            await queryInterface.removeColumn("Users", "admin_avatar_url");
        }

        if (Object.prototype.hasOwnProperty.call(table, "admin_department")) {
            await queryInterface.removeColumn("Users", "admin_department");
        }
    }
};
