"use strict";

module.exports = {
    async up(queryInterface, Sequelize) {
        const columns = await queryInterface.describeTable("Applications");
        if (!columns.is_archived) {
            await queryInterface.addColumn("Applications", "is_archived", {
                type: Sequelize.BOOLEAN,
                allowNull: false,
                defaultValue: false
            });
        }
    },

    async down(queryInterface) {
        const columns = await queryInterface.describeTable("Applications");
        if (columns.is_archived) await queryInterface.removeColumn("Applications", "is_archived");
    }
};
