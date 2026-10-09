"use strict";

const hasTable = async (queryInterface, tableName) => {
    const tables = await queryInterface.showAllTables();
    return tables.some((t) => t.toLowerCase() === tableName.toLowerCase());
};

module.exports = {
    async up(queryInterface, Sequelize) {
        const transaction = await queryInterface.sequelize.transaction();
        try {
            if (!(await hasTable(queryInterface, "RequirementLibrary"))) {
                await queryInterface.createTable(
                    "RequirementLibrary",
                    {
                        id: {
                            type: Sequelize.INTEGER,
                            autoIncrement: true,
                            primaryKey: true
                        },
                        requirement_code: {
                            type: Sequelize.STRING(100),
                            allowNull: false,
                            unique: true
                        },
                        category: {
                            type: Sequelize.STRING(100),
                            allowNull: false
                        },
                        label: {
                            type: Sequelize.STRING(255),
                            allowNull: false
                        },
                        description: {
                            type: Sequelize.TEXT,
                            allowNull: true
                        },
                        requirement_type: {
                            type: Sequelize.ENUM("document_upload", "information_field"),
                            allowNull: false,
                            defaultValue: "document_upload"
                        },
                        value_type: {
                            type: Sequelize.STRING(50),
                            allowNull: true
                        },
                        value_options: {
                            type: Sequelize.JSON,
                            allowNull: true
                        },
                        is_active: {
                            type: Sequelize.BOOLEAN,
                            defaultValue: true
                        },
                        sort_order: {
                            type: Sequelize.INTEGER,
                            defaultValue: 0
                        },
                        created_at: {
                            type: Sequelize.DATE,
                            allowNull: false,
                            defaultValue: Sequelize.literal("CURRENT_TIMESTAMP")
                        },
                        updated_at: {
                            type: Sequelize.DATE,
                            allowNull: false,
                            defaultValue: Sequelize.literal("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP")
                        }
                    },
                    { transaction }
                );

                await queryInterface.addIndex("RequirementLibrary", ["requirement_code"], { transaction });
                await queryInterface.addIndex("RequirementLibrary", ["category"], { transaction });
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
            if (await hasTable(queryInterface, "RequirementLibrary")) {
                await queryInterface.dropTable("RequirementLibrary", { transaction });
            }
            await transaction.commit();
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    }
};