"use strict";

const hasTable = async (queryInterface, tableName) => {
    const tables = await queryInterface.showAllTables();

    return tables.some((table) => {
        if (typeof table === "string") {
            return table.toLowerCase() === tableName.toLowerCase();
        }

        if (table?.tableName) {
            return String(table.tableName).toLowerCase() === tableName.toLowerCase();
        }

        if (table?.TABLE_NAME) {
            return String(table.TABLE_NAME).toLowerCase() === tableName.toLowerCase();
        }

        return String(table).toLowerCase() === tableName.toLowerCase();
    });
};

module.exports = {
    async up(queryInterface, Sequelize) {
        if (!(await hasTable(queryInterface, "email_queue_jobs"))) {
            await queryInterface.createTable("email_queue_jobs", {
                id: {
                    type: Sequelize.INTEGER,
                    allowNull: false,
                    autoIncrement: true,
                    primaryKey: true
                },
                to: {
                    type: Sequelize.STRING,
                    allowNull: false
                },
                subject: {
                    type: Sequelize.STRING,
                    allowNull: false
                },
                message: {
                    type: Sequelize.TEXT("long"),
                    allowNull: false
                },
                status: {
                    type: Sequelize.STRING,
                    allowNull: false,
                    defaultValue: "pending"
                },
                attempts: {
                    type: Sequelize.INTEGER,
                    allowNull: false,
                    defaultValue: 0
                },
                last_error: {
                    type: Sequelize.TEXT("long"),
                    allowNull: true
                },
                available_at: {
                    type: Sequelize.DATE,
                    allowNull: false,
                    defaultValue: Sequelize.literal("CURRENT_TIMESTAMP")
                },
                reserved_at: {
                    type: Sequelize.DATE,
                    allowNull: true
                },
                sent_at: {
                    type: Sequelize.DATE,
                    allowNull: true
                },
                createdAt: {
                    type: Sequelize.DATE,
                    allowNull: false,
                    defaultValue: Sequelize.literal("CURRENT_TIMESTAMP")
                },
                updatedAt: {
                    type: Sequelize.DATE,
                    allowNull: false,
                    defaultValue: Sequelize.literal("CURRENT_TIMESTAMP")
                }
            });

            await queryInterface.addIndex("email_queue_jobs", ["status", "available_at"], {
                name: "email_queue_jobs_status_available_at_idx"
            });
            await queryInterface.addIndex("email_queue_jobs", ["reserved_at"], {
                name: "email_queue_jobs_reserved_at_idx"
            });
        }

        if (!(await hasTable(queryInterface, "rate_limit_entries"))) {
            await queryInterface.createTable("rate_limit_entries", {
                id: {
                    type: Sequelize.INTEGER,
                    allowNull: false,
                    autoIncrement: true,
                    primaryKey: true
                },
                scope: {
                    type: Sequelize.STRING,
                    allowNull: false
                },
                key: {
                    type: Sequelize.STRING,
                    allowNull: false
                },
                window_start: {
                    type: Sequelize.DATE,
                    allowNull: false
                },
                count: {
                    type: Sequelize.INTEGER,
                    allowNull: false,
                    defaultValue: 0
                },
                expires_at: {
                    type: Sequelize.DATE,
                    allowNull: false
                },
                createdAt: {
                    type: Sequelize.DATE,
                    allowNull: false,
                    defaultValue: Sequelize.literal("CURRENT_TIMESTAMP")
                }
            });

            await queryInterface.addIndex("rate_limit_entries", ["scope", "key", "window_start"], {
                unique: true,
                name: "rate_limit_entries_scope_key_window_start_uq"
            });
            await queryInterface.addIndex("rate_limit_entries", ["expires_at"], {
                name: "rate_limit_entries_expires_at_idx"
            });
        }
    },

    async down(queryInterface) {
        if (await hasTable(queryInterface, "rate_limit_entries")) {
            await queryInterface.dropTable("rate_limit_entries");
        }

        if (await hasTable(queryInterface, "email_queue_jobs")) {
            await queryInterface.dropTable("email_queue_jobs");
        }
    }
};
