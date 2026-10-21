const test = require('node:test');
const assert = require('node:assert/strict');
const { Sequelize, DataTypes, QueryTypes } = require('sequelize');
const source = require('../models');
const migration = require('../migrations/20261018-repair-messaging-storage');
const { run } = require('../scripts/repairMessagingStorage');
const { persistMessage } = require('../services/messagePersistence');
test.after(() => source.sequelize.close());

test('reviewed production migration preserves rows/indexes/foreign keys, resumes after interrupted DDL and supports both message channels', { skip: process.env.MESSAGING_MIGRATION_DB_TEST !== '1' }, async () => {
    const config = source.sequelize.config;
    assert.ok(['localhost', '127.0.0.1', '::1'].includes(config.host), 'Never run against a remote/Aiven server.');
    const database = `messaging_production_test_${process.pid}_${Date.now()}`;
    assert.match(database, /^messaging_production_test_\d+_\d+$/);
    assert.notEqual(database, config.database);
    const options = { host: config.host, port: config.port, dialect: 'mysql', logging: false };
    const admin = new Sequelize(config.database, config.username, config.password, options);
    let sql, created = false;
    const statements = [];
    try {
        await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`); created = true;
        sql = new Sequelize(database, config.username, config.password, { ...options, logging: statement => statements.push(statement) });
        const qi = sql.getQueryInterface(), db = { sequelize: sql };
        await qi.createTable('users', { id: { type: DataTypes.INTEGER, primaryKey: true }, name: DataTypes.STRING }, { engine: 'InnoDB' });
        await qi.bulkInsert('users', [1, 2, 3, 4].map(id => ({ id, name: `Fixture ${id}` })));
        for (const name of ['Conversation', 'EmployerConversation', 'ConversationParticipant', 'Message', 'EmployerMessage']) {
            const model = require(`../models/${name}`)(sql, DataTypes); db[name] = model;
            if (name === 'ConversationParticipant') {
                model.removeAttribute('id');
                model.rawAttributes.conversation_id.primaryKey = true;
                model.rawAttributes.user_id.primaryKey = true; model.refreshAttributes();
            }
            const attributes = { ...model.getAttributes() };
            const field = name === 'Message' ? 'file_url' : name === 'EmployerMessage' ? 'attachment' : null;
            if (field) attributes[field] = { type: DataTypes.STRING(255), allowNull: true, comment: 'retain attachment comment' };
            await qi.createTable(model.tableName, attributes, { engine: 'InnoDB', charset: 'utf8mb4', collate: 'utf8mb4_unicode_ci' });
            for (const index of model.options.indexes) await qi.addIndex(model.tableName, index.fields, { ...index });
        }
        for (const [table, field, parent] of [['messages', 'conversation_id', 'conversations'], ['messages', 'sender_id', 'users'], ['employermessages', 'conversationId', 'employerconversations'], ['employermessages', 'senderId', 'users'], ['conversationparticipants', 'conversation_id', 'conversations'], ['conversationparticipants', 'user_id', 'users']]) {
            await qi.addConstraint(table, { fields: [field], type: 'foreign key', name: `${table}_${field}_fixture_fk`, references: { table: parent, field: 'id' }, onDelete: 'RESTRICT', onUpdate: 'CASCADE' });
        }
        const conversation = await db.Conversation.create({ id: 1, type: 'direct', conversation_key: 'fixture_direct' });
        for (const [id, type] of [[2, 'forum'], [3, 'course'], [4, 'batch']]) await db.Conversation.create({ id, type, conversation_key: `fixture_${type}` });
        const employerConversation = await db.EmployerConversation.create({ id: 1, employerId: 2, adminId: 4 });
        await db.ConversationParticipant.bulkCreate([1, 2, 3, 4].map(user_id => ({ conversation_id: 1, user_id, unread_count: 2 })));
        await db.Message.create({ conversation_id: 1, sender_id: 1, message_text: 'Existing fixture', file_url: 'cld:existing_reference_π', file_name: 'Existing.pdf', file_mime: 'application/pdf', file_size: 40 });
        await db.EmployerMessage.create({ conversationId: 1, senderId: 2, senderType: 'employer', message: 'Existing employer fixture', attachment: 'cld:existing_employer_reference', file_name: 'Existing.jpg', file_mime: 'image/jpeg', file_size: 35 });
        const tables = ['users', 'messages', 'employermessages', 'conversations', 'employerconversations', 'conversationparticipants'];
        const rows = async table => sql.query(`SELECT * FROM \`${table}\` ORDER BY ${table === 'conversationparticipants' ? 'conversation_id,user_id' : 'id'}`, { type: QueryTypes.SELECT });
        const indexes = async table => (await qi.showIndex(table)).map(i => ({ name: i.name, unique: i.unique, fields: i.fields.map(f => ({ name: f.attribute, length: f.length || null })) })).sort((a, b) => a.name.localeCompare(b.name));
        const snapshot = {};
        for (const table of tables) snapshot[table] = { rows: await rows(table), indexes: await indexes(table), foreignKeys: await qi.getForeignKeyReferencesForTable(table) };
        const unchanged = async () => {
            for (const table of tables) {
                assert.deepEqual(await rows(table), snapshot[table].rows);
                assert.deepEqual(await indexes(table), snapshot[table].indexes);
                assert.deepEqual(await qi.getForeignKeyReferencesForTable(table), snapshot[table].foreignKeys);
            }
        };
        const initialPlan = (await migration.inspect(qi, Sequelize)).map(({ action, table, column }) => ({ action, table, ...(column ? { column } : {}) }));
        assert.deepEqual(initialPlan, [{ action: 'widen', table: 'messages', column: 'file_url' }, { action: 'widen', table: 'employermessages', column: 'attachment' }, { action: 'create_ledger', table: 'message_send_requests' }]);
        const args = ['--production-plan', '--apply', '--database', database, '--host', config.host];
        const migrationStart = statements.length;
        const originalQuery = sql.query.bind(sql);
        let interrupted = false;
        sql.query = async (statement, settings) => {
            if (!interrupted && typeof statement === 'string' && /^ALTER TABLE `employermessages`/.test(statement)) {
                interrupted = true; throw Object.assign(new Error('Simulated interrupted second DDL'), { code: 'ER_LOCK_WAIT_TIMEOUT' });
            }
            return originalQuery(statement, settings);
        };
        try { await assert.rejects(run(db, args, () => {}), /interrupted second DDL/); }
        finally { sql.query = originalQuery; }
        assert.equal((await qi.describeTable('messages')).file_url.type, 'TEXT');
        assert.equal((await qi.describeTable('employermessages')).attachment.type, 'VARCHAR(255)');
        await unchanged();
        await run(db, args, () => {});
        await unchanged();
        assert.deepEqual(await migration.inspect(qi, Sequelize), []);
        const completed = statements.length;
        await run(db, args, () => {});
        assert.equal(statements.slice(completed).some(s => /\b(?:ALTER|CREATE|DROP|INSERT|UPDATE|DELETE)\b/.test(s)), false);
        const ledgerIndexes = await qi.showIndex('message_send_requests');
        assert.ok(ledgerIndexes.some(i => i.unique && i.fields.map(f => f.attribute).join(',') === 'sender_id,channel,conversation_id,request_key'));
        const create = statements.find(s => /CREATE TABLE IF NOT EXISTS `message_send_requests`/.test(s));
        assert.match(create, /UNIQUE `message_send_requests_identity`/);
        assert.equal(statements.some(s => /ALTER TABLE `message_send_requests` ADD/.test(s)), false);
        const ddl = statements.slice(migrationStart).filter(s => /\b(?:ALTER|CREATE|DROP|RENAME|TRUNCATE)\s+(?:TABLE|DATABASE)\b/i.test(s));
        assert.equal(ddl.length, 3);
        for (const statement of ddl) assert.match(statement, /(?:ALTER TABLE `messages` MODIFY COLUMN `file_url` TEXT|ALTER TABLE `employermessages` MODIFY COLUMN `attachment` TEXT|CREATE TABLE IF NOT EXISTS `message_send_requests`)/);
        assert.equal(statements.slice(migrationStart).some(s => /\b(?:INSERT INTO|UPDATE `|DELETE FROM|DROP TABLE)\b/.test(s)), false);
        const ledger = await qi.describeTable('message_send_requests');
        assert.equal(ledger.id.primaryKey, true); assert.equal(ledger.id.autoIncrement, true);
        for (const field of Object.keys(ledger)) assert.equal(ledger[field].allowNull, false);
        assert.equal(ledger.request_key.type, 'VARCHAR(64)'); assert.equal(ledger.payload_hash.type, 'VARCHAR(64)');
        assert.equal(ledger.channel.type, 'VARCHAR(20)');
        const collations = await sql.query("SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name, COLLATION_NAME AS collation FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND ((TABLE_NAME='messages' AND COLUMN_NAME='file_url') OR (TABLE_NAME='employermessages' AND COLUMN_NAME='attachment') OR (TABLE_NAME='message_send_requests' AND COLUMN_NAME='request_key'))", { type: QueryTypes.SELECT });
        assert.equal(collations.find(row => row.table_name === 'message_send_requests').collation, 'utf8mb4_bin');
        assert.ok(collations.filter(row => row.table_name !== 'message_send_requests').every(row => row.collation === 'utf8mb4_unicode_ci'));
        for (const [table, field] of [['messages', 'file_url'], ['employermessages', 'attachment']]) {
            const description = await qi.describeTable(table);
            assert.equal(description[field].type, 'TEXT'); assert.equal(description[field].allowNull, true);
            assert.equal(description[field].comment, 'retain attachment comment');
        }
        db.MessageSendRequest = require('../models/MessageSendRequest')(sql, DataTypes);
        const reference = 'cld:' + 'complete_reference_'.repeat(100);
        for (const [channel, thread] of [['unified', conversation], ['admin_employer', employerConversation]]) {
            const legacy = channel === 'admin_employer';
            const values = legacy ? { conversationId: thread.id, senderId: 2, senderType: 'employer', attachment: reference } : { conversation_id: thread.id, sender_id: 1, file_url: reference };
            Object.assign(values, { file_name: 'Original.pdf', file_mime: 'application/pdf', file_size: 1500 });
            const first = await persistMessage({ channel, conversation: thread, values, key: 'fixture-retry-key-123456', database: db });
            const retry = await persistMessage({ channel, conversation: thread, values, key: 'fixture-retry-key-123456', database: db });
            assert.equal(first.message[legacy ? 'attachment' : 'file_url'], reference);
            assert.equal(first.message.id, retry.message.id); assert.equal(retry.replayed, true);
        }
    } finally {
        if (sql) await sql.close();
        if (created) {
            assert.match(database, /^messaging_production_test_\d+_\d+$/); assert.notEqual(database, config.database);
            await admin.query(`DROP DATABASE \`${database}\``);
        }
        await admin.close();
    }
});
