"use strict";

const hasColumn = async (queryInterface, tableName, columnName) => {
    const columns = await queryInterface.describeTable(tableName);
    return Boolean(columns[columnName]);
};

module.exports = {
    async up(queryInterface, Sequelize) {
        const transaction = await queryInterface.sequelize.transaction();
        try {
            if (!(await hasColumn(queryInterface, "Jobs", "current_requirement_version"))) {
                await queryInterface.addColumn(
                    "Jobs",
                    "current_requirement_version",
                    {
                        type: Sequelize.INTEGER,
                        defaultValue: 0
                    },
                    { transaction }
                );
            }

            if (!(await hasColumn(queryInterface, "Jobs", "has_requirements"))) {
                await queryInterface.addColumn(
                    "Jobs",
                    "has_requirements",
                    {
                        type: Sequelize.BOOLEAN,
                        defaultValue: false
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
            if (await hasColumn(queryInterface, "Jobs", "current_requirement_version")) {
                await queryInterface.removeColumn("Jobs", "current_requirement_version", { transaction });
            }
            if (await hasColumn(queryInterface, "Jobs", "has_requirements")) {
                await queryInterface.removeColumn("Jobs", "has_requirements", { transaction });
            }
            await transaction.commit();
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    }
};