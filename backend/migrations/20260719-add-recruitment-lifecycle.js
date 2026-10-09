"use strict";

const hasColumn = async (queryInterface, tableName, columnName) => {
    const columns = await queryInterface.describeTable(tableName);
    return Boolean(columns[columnName]);
};

module.exports = {
    async up(queryInterface, Sequelize) {
        const transaction = await queryInterface.sequelize.transaction();
        try {
            if (!(await hasColumn(queryInterface, "Jobs", "recruitment_status"))) {
                await queryInterface.addColumn(
                    "Jobs",
                    "recruitment_status",
                    {
                        type: Sequelize.STRING,
                        defaultValue: "active",
                        allowNull: false
                    },
                    { transaction }
                );
            }

            if (!(await hasColumn(queryInterface, "Applications", "recruitment_cycle"))) {
                await queryInterface.addColumn(
                    "Applications",
                    "recruitment_cycle",
                    {
                        type: Sequelize.INTEGER,
                        defaultValue: 1,
                        allowNull: false
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
            if (await hasColumn(queryInterface, "Jobs", "recruitment_status")) {
                await queryInterface.removeColumn("Jobs", "recruitment_status", { transaction });
            }
            if (await hasColumn(queryInterface, "Applications", "recruitment_cycle")) {
                await queryInterface.removeColumn("Applications", "recruitment_cycle", { transaction });
            }
            await transaction.commit();
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    }
};