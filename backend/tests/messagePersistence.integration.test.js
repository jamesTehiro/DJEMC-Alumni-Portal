const test = require('node:test');
const assert = require('node:assert/strict');
const { Sequelize, DataTypes } = require('sequelize');
const db = require('../models');
const { persistMessage, requestKey } = require('../services/messagePersistence');

test.after(() => db.sequelize.close());

test('real MySQL transactions preserve history, roll back failures, and deduplicate retries in both channels', { skip: process.env.MESSAGING_DB_TEST !== '1' }, async () => {
    // Opt-in, local only. Every write targets connection-local TEMPORARY tables;
    // application tables, accounts, conversations and files are never changed.
    assert.ok(['localhost', '127.0.0.1', '::1'].includes(db.sequelize.config.host), 'Integration tests require a local database.');
    const sql = new Sequelize(db.sequelize.config.database, db.sequelize.config.username, db.sequelize.config.password, {
        host: db.sequelize.config.host, port: db.sequelize.config.port, dialect: 'mysql', logging: false,
        pool: { max: 1, min: 1, idle: 60000 }
    });
    const database = { sequelize: sql };
    const tables = [];
    try {
        for (const name of ['Message', 'EmployerMessage', 'Conversation', 'EmployerConversation', 'MessageSendRequest']) {
            const model = require(`../models/${name}`)(sql, DataTypes);
            const table = `messaging_test_${process.pid}_${name.toLowerCase()}`;
            model.tableName = table; model.options.tableName = table;
            const attributes = sql.getQueryInterface().queryGenerator.attributesToSQL(model.getAttributes(), { table });
            let ddl = sql.getQueryInterface().queryGenerator.createTableQuery(table, attributes, { engine: 'InnoDB' });
            ddl = ddl.replace(/^CREATE TABLE IF NOT EXISTS/, 'CREATE TEMPORARY TABLE');
            assert.match(ddl, /^CREATE TEMPORARY TABLE `messaging_test_[a-z0-9_]+`/);
            await sql.query(ddl); tables.push(table); database[name] = model;
        }
        await sql.query(`ALTER TABLE \`${database.MessageSendRequest.tableName}\` ADD UNIQUE KEY request_identity (sender_id,channel,conversation_id,request_key)`);
        const reference = 'cld:' + Buffer.from(JSON.stringify({ provider: 'cloudinary', resourceType: 'raw', type: 'authenticated', publicId: 'private_uploads/chat/new-proof.pdf', url: 'https://res.cloudinary.com/fixture/raw/authenticated/s--fixture--/v123/private_uploads/chat/new-proof.pdf', originalName: 'new-proof.pdf' })).toString('base64url');
        assert.ok(reference.length > 255);
        for (const channel of ['unified', 'admin_employer']) {
            const legacy = channel === 'admin_employer';
            const Conversation = legacy ? database.EmployerConversation : database.Conversation;
            const Message = legacy ? database.EmployerMessage : database.Message;
            const conversation = await Conversation.create(legacy ? { employerId: 7, adminId: 2 } : { type: 'direct', conversation_key: 'direct_2_7' });
            const values = legacy ? { conversationId: conversation.id, senderId: 7, senderType: 'employer', message: 'Fixture', attachment: reference } : { conversation_id: conversation.id, sender_id: 7, message_text: 'Fixture', file_url: reference };
            Object.assign(values, { file_name: 'new-proof.pdf', file_mime: 'application/pdf', file_size: 22 });
            const send = (overrides = {}) => persistMessage({ channel, conversation, values, key: 'retry-request-123456', database, ...overrides });
            const [first, retry] = await Promise.all([send(), send()]);
            assert.equal(first.message.id, retry.message.id);
            assert.equal([first, retry].filter(result => result.replayed).length, 1);
            assert.equal(await Message.count(), 1);
            const history = await Message.findAll();
            assert.equal(history[0][legacy ? 'attachment' : 'file_url'], reference);
            assert.equal(history[0].file_mime, 'application/pdf');
            assert.equal((await Conversation.findByPk(conversation.id)).last_message_text, 'Fixture');
            await assert.rejects(send({ values: { ...values, [legacy ? 'message' : 'message_text']: 'Changed' } }), { status: 409 });

            // Same key in another conversation or sender must not replay another message.
            const second = await Conversation.create(legacy ? { employerId: 8, adminId: 2 } : { type: 'direct', conversation_key: 'direct_2_8' });
            const scoped = await send({ conversation: second, values: { ...values, [legacy ? 'conversationId' : 'conversation_id']: second.id } });
            assert.equal(scoped.replayed, false);
            const otherSender = await send({ values: { ...values, [legacy ? 'senderId' : 'sender_id']: 2 } });
            assert.equal(otherSender.replayed, false);

            const before = await Message.count(), ledgerBefore = await database.MessageSendRequest.count();
            const originalUpdate = Conversation.prototype.update;
            Conversation.prototype.update = async function(changes, options) {
                // A real SQL failure after INSERT, inside the same transaction.
                await sql.query('SELECT missing_messaging_test_column', { transaction: options.transaction });
            };
            try { await assert.rejects(send({ key: 'failed-summary-123456' }), error => error.original?.code === 'ER_BAD_FIELD_ERROR'); }
            finally { Conversation.prototype.update = originalUpdate; }
            assert.equal(await Message.count(), before);
            assert.equal(await database.MessageSendRequest.count(), ledgerBefore);

            // Simulate a legacy non-strict VARCHAR column silently truncating a
            // provider reference. The service must detect it and roll back.
            const referenceField = legacy ? 'attachment' : 'file_url';
            await sql.query(`ALTER TABLE \`${Message.tableName}\` MODIFY \`${referenceField}\` VARCHAR(255)`);
            const [mode] = await sql.query('SELECT @@SESSION.sql_mode AS mode', { type: Sequelize.QueryTypes.SELECT });
            await sql.query('SET SESSION sql_mode = :mode', { replacements: { mode: mode.mode.replace(/STRICT_(?:TRANS|ALL)_TABLES,?/g, '').replace(/,$/, '') } });
            try { await assert.rejects(send({ key: 'truncated-request-1234' }), { code: 'MESSAGE_METADATA_NOT_PERSISTED', status: 503 }); }
            finally { await sql.query('SET SESSION sql_mode = :mode', { replacements: { mode: mode.mode } }); }
            assert.equal(await Message.count(), before);
            assert.equal(await database.MessageSendRequest.count(), ledgerBefore);
        }
        assert.equal(requestKey('retry-request-123456'), 'retry-request-123456');
        assert.throws(() => requestKey('../../invalid'), { status: 400 });
    } finally {
        for (const table of tables.reverse()) {
            assert.match(table, /^messaging_test_[a-z0-9_]+$/);
            await sql.query(`DROP TEMPORARY TABLE IF EXISTS \`${table}\``);
        }
        await sql.close();
    }
});
