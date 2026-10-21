const test = require('node:test');
const assert = require('node:assert/strict');
const { Sequelize, DataTypes, QueryTypes } = require('sequelize');
const db = require('../models');
const migration = require('../migrations/20261018-repair-messaging-storage');
test.after(() => db.sequelize.close());

test('messaging repair preserves rows and is idempotent on a separate local MySQL database', { skip: process.env.MESSAGING_MIGRATION_DB_TEST !== '1' }, async () => {
    const config = db.sequelize.config;
    assert.ok(['localhost', '127.0.0.1', '::1'].includes(config.host), 'Only a local test server is allowed.');
    const database = `attachment_migration_test_${process.pid}_${Date.now()}`;
    assert.match(database, /^attachment_migration_test_\d+_\d+$/);
    assert.notEqual(database, config.database);
    const admin = new Sequelize(config.database, config.username, config.password, { host: config.host, port: config.port, dialect: 'mysql', logging: false });
    let isolated;
    let created = false;
    try {
        await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
        created = true;
        isolated = new Sequelize(database, config.username, config.password, { host: config.host, port: config.port, dialect: 'mysql', logging: false });
        const qi = isolated.getQueryInterface();
        const essentials = {
            messages: ['id', 'conversation_id', 'sender_id', 'message_text', 'is_read', 'createdAt', 'updatedAt'],
            employermessages: ['id', 'conversationId', 'senderType', 'senderId', 'message', 'createdAt', 'updatedAt'],
            conversations: ['id', 'conversation_key', 'type'], employerconversations: ['id', 'employerId', 'adminId'],
            conversationparticipants: ['conversation_id', 'user_id']
        };
        for (const [table, fields] of Object.entries(essentials)) {
            const definition = Object.fromEntries(fields.map(field => [field, { type: DataTypes.STRING, allowNull: true }]));
            if (table === 'messages') definition.file_url = { type: DataTypes.STRING(255), allowNull: true, comment: 'retain me' };
            if (table === 'employermessages') definition.attachment = { type: DataTypes.STRING(255), allowNull: true, comment: 'retain me' };
            await qi.createTable(table, definition, { engine: 'InnoDB' });
            await qi.bulkInsert(table, [Object.fromEntries(Object.keys(definition).map(field => [field, field === 'id' ? '1' : `old_${field}`]))]);
        }
        const before = {};
        for (const table of Object.keys(essentials)) before[table] = await isolated.query(`SELECT * FROM \`${table}\``, { type: QueryTypes.SELECT });
        assert.ok((await migration.inspect(qi, Sequelize)).some(item => item.action === 'widen'));
        await migration.up(qi, Sequelize);
        assert.deepEqual(await migration.inspect(qi, Sequelize), []);
        await migration.up(qi, Sequelize);
        for (const [table, rows] of Object.entries(before)) {
            const after = await isolated.query(`SELECT * FROM \`${table}\``, { type: QueryTypes.SELECT });
            assert.equal(after.length, rows.length);
            for (const field of Object.keys(rows[0])) assert.equal(after[0][field], rows[0][field]);
        }
        for (const [table, field] of [['messages', 'file_url'], ['employermessages', 'attachment']]) {
            const description = await qi.describeTable(table);
            assert.equal(description[field].type, 'TEXT');
            assert.equal(description[field].comment, 'retain me');
            const reference = 'cld:' + 'a'.repeat(1400);
            await isolated.query(`UPDATE \`${table}\` SET \`${field}\` = :reference`, { replacements: { reference } });
            const [row] = await isolated.query(`SELECT \`${field}\` AS reference FROM \`${table}\``, { type: QueryTypes.SELECT });
            assert.equal(row.reference, reference);
        }
    } finally {
        if (isolated) await isolated.close();
        // Only remove the database created by this test invocation.
        if (created) {
            assert.match(database, /^attachment_migration_test_\d+_\d+$/);
            assert.notEqual(database, config.database);
            await admin.query(`DROP DATABASE \`${database}\``);
        }
        await admin.close();
    }
});
