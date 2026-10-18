const test = require('node:test');
const assert = require('node:assert/strict');
const Sequelize = require('sequelize');
const migration = require('../migrations/20261018-repair-messaging-storage');
const { run } = require('../scripts/repairMessagingStorage');

const fixture = () => {
    const schemas = {};
    const essentials = {
        messages: ['id', 'conversation_id', 'sender_id', 'message_text', 'is_read', 'createdAt', 'updatedAt'],
        employermessages: ['id', 'conversationId', 'senderType', 'senderId', 'message', 'createdAt', 'updatedAt'],
        conversations: ['id', 'conversation_key', 'type'], employerconversations: ['id', 'employerId', 'adminId'],
        conversationparticipants: ['conversation_id', 'user_id']
    };
    for (const [table, fields] of Object.entries(essentials)) schemas[table] = Object.fromEntries(fields.map(field => [field, { type: 'INTEGER' }]));
    schemas.messages.file_url = { type: 'TEXT' };
    schemas.employermessages.attachment = { type: 'TEXT' };
    const writes = [], indexes = {};
    const qi = {
        showAllTables: async () => Object.keys(schemas),
        describeTable: async table => { assert.ok(schemas[table], `Case-sensitive table lookup: ${table}`); return schemas[table]; },
        showIndex: async table => indexes[table] || [],
        addColumn: async (table, field, definition) => { writes.push(['add', table, field]); schemas[table][field] = definition; },
        createTable: async (table, definition) => { writes.push(['create', table]); assert.equal(table, 'message_send_requests'); schemas[table] = definition; },
        addIndex: async (table, fields, options) => { writes.push(['index', table]); indexes[table] = [{ ...options, fields: fields.map(attribute => ({ attribute })) }]; }
    };
    return { schemas, writes, qi, indexes };
};

test('repair fills missing lowercase messaging metadata and creates only the retry ledger; reapplying is inert', async () => {
    const f = fixture();
    const plan = await migration.inspect(f.qi, Sequelize);
    assert.ok(plan.some(item => item.table === 'employermessages' && item.column === 'file_name'));
    assert.equal(f.writes.length, 0);
    await migration.up(f.qi, Sequelize);
    assert.ok(f.schemas.messages.file_size);
    assert.ok(f.schemas.conversations.last_message_at);
    assert.ok(f.schemas.conversationparticipants.last_read_at);
    assert.ok(f.schemas.message_send_requests.payload_hash);
    const count = f.writes.length;
    await migration.up(f.qi, Sequelize);
    assert.equal(f.writes.length, count);
    assert.ok(f.writes.every(([action, table]) => action === 'add' || table === 'message_send_requests'));
    await assert.rejects(migration.down(), /destructive rollback/);
});

test('case mismatches, absent relationship columns and ambiguous tables fail before any DDL', async () => {
    for (const mutate of [f => { f.schemas.Messages = f.schemas.messages; delete f.schemas.messages; },
        f => { f.schemas.Messages = f.schemas.messages; }, f => { delete f.schemas.employermessages.conversationId; }]) {
        const f = fixture(); mutate(f);
        await assert.rejects(migration.up(f.qi, Sequelize));
        assert.equal(f.writes.length, 0);
    }
});

test('VARCHAR references require widening; indexed or unsupported definitions require manual review', async () => {
    const f = fixture();
    f.schemas.messages.file_url = { type: 'VARCHAR(255)', defaultValue: null };
    assert.ok((await migration.inspect(f.qi, Sequelize)).some(item => item.action === 'widen' && item.table === 'messages'));
    f.indexes.messages = [{ fields: [{ attribute: 'file_url' }] }];
    await assert.rejects(migration.up(f.qi, Sequelize), /Indexed/);
    assert.equal(f.writes.length, 0);
});

test('the repair command defaults to read-only and refuses a mismatched explicit target', async () => {
    const f = fixture();
    const db = { sequelize: { config: { host: 'fixture-host' }, authenticate: async () => {}, query: async () => [{ database_name: 'fixture_db' }], getQueryInterface: () => f.qi } };
    const log = console.log; console.log = () => {};
    try {
        await run(db, []);
        assert.equal(f.writes.length, 0);
        await assert.rejects(run(db, ['--apply']), /requires/);
        await assert.rejects(run(db, ['--apply', '--database', 'other', '--host', 'fixture-host']), /mismatch/);
        assert.equal(f.writes.length, 0);
        await run(db, ['--apply', '--database', 'fixture_db', '--host', 'fixture-host']);
        assert.ok(f.writes.length);
    } finally { console.log = log; }
});
