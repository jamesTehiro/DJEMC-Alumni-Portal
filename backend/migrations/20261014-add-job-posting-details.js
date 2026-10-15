"use strict";

module.exports = {
    async up(queryInterface, Sequelize) {
        const columns = await queryInterface.describeTable("Jobs");
        if (!columns.posting_details) {
            await queryInterface.addColumn("Jobs", "posting_details", { type: Sequelize.JSON, allowNull: true, defaultValue: null });
        }
    },
    async down() {
        throw new Error("Structured job advertisements must be preserved. Automatic column removal is disabled.");
    }
};
