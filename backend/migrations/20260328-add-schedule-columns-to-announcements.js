"use strict";

module.exports = {
    async up(queryInterface, Sequelize) {
        const table = await queryInterface.describeTable("Announcements");

        if (!Object.prototype.hasOwnProperty.call(table, "day")) {
            await queryInterface.addColumn("Announcements", "day", {
                type: Sequelize.DATEONLY,
                allowNull: true
            });
        }

        if (!Object.prototype.hasOwnProperty.call(table, "time")) {
            await queryInterface.addColumn("Announcements", "time", {
                type: Sequelize.STRING,
                allowNull: true
            });
        }

        if (!Object.prototype.hasOwnProperty.call(table, "location")) {
            await queryInterface.addColumn("Announcements", "location", {
                type: Sequelize.STRING,
                allowNull: true
            });
        }
    },

    async down(queryInterface) {
        const table = await queryInterface.describeTable("Announcements");

        if (Object.prototype.hasOwnProperty.call(table, "location")) {
            await queryInterface.removeColumn("Announcements", "location");
        }

        if (Object.prototype.hasOwnProperty.call(table, "time")) {
            await queryInterface.removeColumn("Announcements", "time");
        }

        if (Object.prototype.hasOwnProperty.call(table, "day")) {
            await queryInterface.removeColumn("Announcements", "day");
        }
    }
};
