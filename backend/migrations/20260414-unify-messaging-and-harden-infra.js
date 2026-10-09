"use strict";

const hasTable = async (queryInterface, tableName) => {
    const tables = await queryInterface.showAllTables();

    return tables.some((table) => {
        if (typeof table === "string") return table.toLowerCase() === tableName.toLowerCase();
        if (table?.tableName) return String(table.tableName).toLowerCase() === tableName.toLowerCase();
        if (table?.TABLE_NAME) return String(table.TABLE_NAME).toLowerCase() === tableName.toLowerCase();
        return String(table).toLowerCase() === tableName.toLowerCase();
    });
};

const hasColumn = async (queryInterface, tableName, columnName) => {
    const columns = await queryInterface.describeTable(tableName);
    return Boolean(columns[columnName]);
};

const hasIndex = async (queryInterface, tableName, indexName) => {
    const indexes = await queryInterface.showIndex(tableName);
    return indexes.some((index) => index.name === indexName);
};

module.exports = {
    async up(queryInterface, Sequelize) {
        const transaction = await queryInterface.sequelize.transaction();

        try {
            if (await hasTable(queryInterface, "Conversations")) {
                if (!(await hasColumn(queryInterface, "Conversations", "type"))) {
                    await queryInterface.addColumn(
                        "Conversations",
                        "type",
                        {
                            type: Sequelize.STRING,
                            allowNull: false,
                            defaultValue: "direct"
                        },
                        { transaction }
                    );
                }

                await queryInterface.sequelize.query(
                    `UPDATE Conversations
                     SET type = CASE
                         WHEN type IS NOT NULL AND type <> '' THEN type
                         WHEN user1Id IS NOT NULL AND user2Id IS NOT NULL THEN 'direct'
                         ELSE 'group'
                     END`,
                    { transaction }
                );

                await queryInterface.sequelize.query(
                    `UPDATE Conversations
                     SET conversation_key = CONCAT('direct:', LEAST(user1Id, user2Id), ':', GREATEST(user1Id, user2Id))
                     WHERE conversation_key IS NULL
                       AND user1Id IS NOT NULL
                       AND user2Id IS NOT NULL`,
                    { transaction }
                );

                if (!(await hasIndex(queryInterface, "Conversations", "conversations_type_last_message_at_idx"))) {
                    await queryInterface.addIndex("Conversations", ["type", "last_message_at"], {
                        name: "conversations_type_last_message_at_idx",
                        transaction
                    });
                }
            }

            if (await hasTable(queryInterface, "Messages")) {
                if (!(await hasColumn(queryInterface, "Messages", "file_path"))) {
                    await queryInterface.addColumn(
                        "Messages",
                        "file_path",
                        {
                            type: Sequelize.STRING,
                            allowNull: true
                        },
                        { transaction }
                    );
                }

                if (!(await hasIndex(queryInterface, "Messages", "messages_conversation_id_id_idx"))) {
                    await queryInterface.addIndex("Messages", ["conversation_id", "id"], {
                        name: "messages_conversation_id_id_idx",
                        transaction
                    });
                }
            }

            if (await hasTable(queryInterface, "ConversationParticipants")) {
                await queryInterface.sequelize.query(
                    `INSERT INTO ConversationParticipants (conversation_id, user_id, unread_count, last_read_at, createdAt, updatedAt)
                     SELECT c.id, c.user1Id, 0, NOW(), NOW(), NOW()
                     FROM Conversations c
                     WHERE c.user1Id IS NOT NULL
                       AND NOT EXISTS (
                           SELECT 1 FROM ConversationParticipants cp
                           WHERE cp.conversation_id = c.id AND cp.user_id = c.user1Id
                       )`,
                    { transaction }
                );

                await queryInterface.sequelize.query(
                    `INSERT INTO ConversationParticipants (conversation_id, user_id, unread_count, last_read_at, createdAt, updatedAt)
                     SELECT c.id, c.user2Id, 0, NOW(), NOW(), NOW()
                     FROM Conversations c
                     WHERE c.user2Id IS NOT NULL
                       AND NOT EXISTS (
                           SELECT 1 FROM ConversationParticipants cp
                           WHERE cp.conversation_id = c.id AND cp.user_id = c.user2Id
                       )`,
                    { transaction }
                );

                if (!(await hasIndex(queryInterface, "ConversationParticipants", "conversation_participants_conversation_id_user_id_uq"))) {
                    await queryInterface.addIndex("ConversationParticipants", ["conversation_id", "user_id"], {
                        unique: true,
                        name: "conversation_participants_conversation_id_user_id_uq",
                        transaction
                    });
                }
            }

            if ((await hasTable(queryInterface, "EmployerConversations")) && (await hasTable(queryInterface, "Conversations"))) {
                await queryInterface.sequelize.query(
                    `INSERT INTO Conversations (conversation_key, name, type, last_message_text, last_message_at, createdAt, updatedAt)
                     SELECT
                        CONCAT('employer_admin:', ec.adminId, ':', ec.employerId),
                        COALESCE(ep.organization_name, u.name),
                        'employer_admin',
                        ec.last_message_text,
                        ec.last_message_at,
                        ec.createdAt,
                        ec.updatedAt
                     FROM EmployerConversations ec
                     INNER JOIN Users u ON u.id = ec.employerId
                     LEFT JOIN EmployerProfiles ep ON ep.user_id = u.id
                     WHERE NOT EXISTS (
                        SELECT 1 FROM Conversations c
                        WHERE c.conversation_key = CONCAT('employer_admin:', ec.adminId, ':', ec.employerId)
                     )`,
                    { transaction }
                );

                await queryInterface.sequelize.query(
                    `INSERT INTO ConversationParticipants (conversation_id, user_id, unread_count, last_read_at, createdAt, updatedAt)
                     SELECT c.id, ec.employerId, 0, NULL, NOW(), NOW()
                     FROM EmployerConversations ec
                     INNER JOIN Conversations c
                        ON c.conversation_key = CONCAT('employer_admin:', ec.adminId, ':', ec.employerId)
                     WHERE NOT EXISTS (
                        SELECT 1 FROM ConversationParticipants cp
                        WHERE cp.conversation_id = c.id AND cp.user_id = ec.employerId
                     )`,
                    { transaction }
                );

                await queryInterface.sequelize.query(
                    `INSERT INTO ConversationParticipants (conversation_id, user_id, unread_count, last_read_at, createdAt, updatedAt)
                     SELECT c.id, ec.adminId, 0, NULL, NOW(), NOW()
                     FROM EmployerConversations ec
                     INNER JOIN Conversations c
                        ON c.conversation_key = CONCAT('employer_admin:', ec.adminId, ':', ec.employerId)
                     WHERE NOT EXISTS (
                        SELECT 1 FROM ConversationParticipants cp
                        WHERE cp.conversation_id = c.id AND cp.user_id = ec.adminId
                     )`,
                    { transaction }
                );

                if (await hasTable(queryInterface, "EmployerMessages")) {
                    await queryInterface.sequelize.query(
                        `INSERT INTO Messages (
                            conversation_id, sender_id, message_text, file_url, file_path, file_name, file_mime, is_read, createdAt, updatedAt
                         )
                         SELECT
                            c.id,
                            em.senderId,
                            em.message,
                            CASE
                                WHEN em.attachment IS NOT NULL AND em.attachment <> ''
                                    THEN CONCAT('/api/admin-employer/messages/files/', SUBSTRING_INDEX(em.attachment, '\\\\', -1))
                                ELSE NULL
                            END,
                            em.attachment,
                            CASE
                                WHEN em.attachment IS NOT NULL AND em.attachment <> ''
                                    THEN SUBSTRING_INDEX(REPLACE(em.attachment, '\\\\', '/'), '/', -1)
                                ELSE NULL
                            END,
                            NULL,
                            FALSE,
                            em.createdAt,
                            em.updatedAt
                         FROM EmployerMessages em
                         INNER JOIN EmployerConversations ec ON ec.id = em.conversationId
                         INNER JOIN Conversations c
                            ON c.conversation_key = CONCAT('employer_admin:', ec.adminId, ':', ec.employerId)
                         WHERE NOT EXISTS (
                            SELECT 1 FROM Messages m
                            WHERE m.conversation_id = c.id
                              AND m.sender_id = em.senderId
                              AND COALESCE(m.message_text, '') = COALESCE(em.message, '')
                              AND COALESCE(m.file_path, '') = COALESCE(em.attachment, '')
                              AND m.createdAt = em.createdAt
                         )`,
                        { transaction }
                    );
                }
            }

            if (await hasTable(queryInterface, "email_queue_jobs")) {
                if (await hasColumn(queryInterface, "email_queue_jobs", "available_at")) {
                    await queryInterface.renameColumn("email_queue_jobs", "available_at", "scheduled_at", { transaction });
                }

                if (await hasColumn(queryInterface, "email_queue_jobs", "reserved_at")) {
                    await queryInterface.renameColumn("email_queue_jobs", "reserved_at", "processing_started_at", { transaction });
                }

                if (!(await hasColumn(queryInterface, "email_queue_jobs", "max_attempts"))) {
                    await queryInterface.addColumn(
                        "email_queue_jobs",
                        "max_attempts",
                        {
                            type: Sequelize.INTEGER,
                            allowNull: false,
                            defaultValue: 5
                        },
                        { transaction }
                    );
                }
            }

            if (await hasTable(queryInterface, "Users")) {
                if (!(await hasIndex(queryInterface, "Users", "users_email_uq"))) {
                    await queryInterface.addIndex("Users", ["email"], {
                        unique: true,
                        name: "users_email_uq",
                        transaction
                    });
                }

                if (!(await hasIndex(queryInterface, "Users", "users_role_admin_scope_uq"))) {
                    await queryInterface.addIndex("Users", ["role", "admin_scope"], {
                        unique: true,
                        name: "users_role_admin_scope_uq",
                        transaction
                    });
                }
            }

            await transaction.commit();

            if (await hasTable(queryInterface, "EmployerMessages")) {
                await queryInterface.dropTable("EmployerMessages");
            }

            if (await hasTable(queryInterface, "EmployerConversations")) {
                await queryInterface.dropTable("EmployerConversations");
            }
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },

    async down(queryInterface, Sequelize) {
        if (await hasTable(queryInterface, "Messages")) {
            if (await hasColumn(queryInterface, "Messages", "file_path")) {
                await queryInterface.removeColumn("Messages", "file_path");
            }
        }

        if (await hasTable(queryInterface, "email_queue_jobs")) {
            if (await hasColumn(queryInterface, "email_queue_jobs", "processing_started_at")) {
                await queryInterface.renameColumn("email_queue_jobs", "processing_started_at", "reserved_at");
            }

            if (await hasColumn(queryInterface, "email_queue_jobs", "scheduled_at")) {
                await queryInterface.renameColumn("email_queue_jobs", "scheduled_at", "available_at");
            }

            if (await hasColumn(queryInterface, "email_queue_jobs", "max_attempts")) {
                await queryInterface.removeColumn("email_queue_jobs", "max_attempts");
            }
        }

        if (await hasTable(queryInterface, "Conversations")) {
            await queryInterface.sequelize.query(
                `DELETE FROM ConversationParticipants
                 WHERE conversation_id IN (
                    SELECT id FROM Conversations WHERE type = 'employer_admin'
                 )`
            );

            await queryInterface.sequelize.query(`DELETE FROM Conversations WHERE type = 'employer_admin'`);
        }
    }
};
