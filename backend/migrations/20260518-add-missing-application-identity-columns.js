"use strict";

const hasColumn = async (queryInterface, tableName, columnName) => {
    const columns = await queryInterface.describeTable(tableName);
    return Boolean(columns[columnName]);
};

module.exports = {
    async up(queryInterface, Sequelize) {
        if (!(await hasColumn(queryInterface, "Applications", "full_name"))) {
            await queryInterface.addColumn("Applications", "full_name", {
                type: Sequelize.STRING,
                allowNull: true
            });
        }

        if (!(await hasColumn(queryInterface, "Applications", "email"))) {
            await queryInterface.addColumn("Applications", "email", {
                type: Sequelize.STRING,
                allowNull: true
            });
        }

        if (!(await hasColumn(queryInterface, "Applications", "dob"))) {
            await queryInterface.addColumn("Applications", "dob", {
                type: Sequelize.DATEONLY,
                allowNull: true
            });
        }
    },

    async down(queryInterface) {
        if (await hasColumn(queryInterface, "Applications", "dob")) {
            await queryInterface.removeColumn("Applications", "dob");
        }

        if (await hasColumn(queryInterface, "Applications", "email")) {
            await queryInterface.removeColumn("Applications", "email");
        }

        if (await hasColumn(queryInterface, "Applications", "full_name")) {
            await queryInterface.removeColumn("Applications", "full_name");
        }
    }
};
