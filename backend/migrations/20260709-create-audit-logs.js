"use strict";

const hasTable = async (queryInterface, tableName) => {
    const tables = await queryInterface.showAllTables();
    return tables.some((t) => t.toLowerCase() === tableName.toLowerCase());
};

module.exports = {
    async up(queryInterface, Sequelize) {
        const transaction = await queryInterface.sequelize.transaction();
        try {
            if (!(await hasTable(queryInterface, "AuditLogs"))) {
                await queryInterface.createTable(
                    "AuditLogs",
                    {
                        id: { type: Sequelize.BIGINT, autoIncrement: true, primaryKey: true },
                        actor_id: { type: Sequelize.INTEGER, allowNull: false },
                        actor_role: { type: Sequelize.STRING(50), allowNull: false },
                        action: { type: Sequelize.STRING(100), allowNull: false },
                        target_type: { type: Sequelize.STRING(50), allowNull: false },
                        target_id: { type: Sequelize.INTEGER, allowNull: true },
                        requirement_code: { type: Sequelize.STRING(100), allowNull: true },
                        metadata: { type: Sequelize.JSON, allowNull: true },
                        ip_address: { type: Sequelize.STRING(45), allowNull: true },
                        created_at: {
                            type: Sequelize.DATE,
                            allowNull: false,
                            defaultValue: Sequelize.literal("CURRENT_TIMESTAMP")
                        }
                    },
                    { transaction }
                );

                await queryInterface.addIndex("AuditLogs", ["actor_id"], { transaction });
                await queryInterface.addIndex("AuditLogs", ["action"], { transaction });
                await queryInterface.addIndex("AuditLogs", ["target_type", "target_id"], { transaction });
                await queryInterface.addIndex("AuditLogs", ["requirement_code"], { transaction });
                await queryInterface.addIndex("AuditLogs", ["created_at"], { transaction });
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
            if (await hasTable(queryInterface, "AuditLogs")) {
                await queryInterface.dropTable("AuditLogs", { transaction });
            }
            await transaction.commit();
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    }
};