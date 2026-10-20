const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { once } = require('node:events');
const { spawn: spawnChild } = require('node:child_process');
const { Sequelize, DataTypes, QueryTypes } = require('sequelize');
const { diagnose, createReadOnlyDatabase } = require('../scripts/diagnoseMessagingSchema');
const { diagnoseBeforeStart, startBackend } = require('../scripts/startWithMessagingDiagnostic');

function fixture() {
    const sql = new Sequelize('offline_fixture', 'fixture', 'secret-password-never-print', { dialect: 'mysql', logging: false });
    const database = { Sequelize: { QueryTypes } };
    for (const name of ['Message', 'EmployerMessage', 'Conversation', 'EmployerConversation', 'ConversationParticipant', 'MessageSendRequest']) database[name] = require(`../models/${name}`)(sql, DataTypes);
    const schemas = Object.fromEntries(Object.values(database).filter(model => model.rawAttributes).filter(model => model !== database.MessageSendRequest).map(model => [model.getTableName(), Object.fromEntries(Object.entries(model.rawAttributes).map(([key, attribute]) => [attribute.field || key, { type: key === 'file_url' || key === 'attachment' ? 'TEXT' : 'INTEGER' }]))]));
    const qi = {
        showAllTables: async () => Object.keys(schemas),
        describeTable: async table => schemas[table],
        showIndex: async () => [],
        addColumn: async () => assert.fail('DDL is forbidden'),
        createTable: async () => assert.fail('DDL is forbidden'),
        addIndex: async () => assert.fail('DDL is forbidden')
    };
    const reads = [];
    database.sequelize = { config: { host: 'fixture-host' }, authenticate: async () => {}, getQueryInterface: () => qi, query: async query => {
        assert.match(query, /^SELECT /);
        reads.push(query);
        return query.includes('DATABASE() AS database_name') ? [{ database_name: 'offline_fixture' }] : [{ engine: 'InnoDB' }];
    } };
    return { database, schemas, reads, qi, close: () => sql.close() };
}

test('deployment diagnostic reports missing columns/indexes/ledger and invokes only the migration dry run', async () => {
    const f = fixture(), output = [];
    delete f.schemas.employermessages.file_mime;
    try {
        await diagnose(f.database, value => output.push(value));
        assert.ok(output.some(value => value.table === 'employermessages' && value.missingColumns.includes('file_mime')));
        assert.ok(output.some(value => value.table === 'messages' && value.missingIndexes.length));
        assert.ok(output.some(value => value.table === 'message_send_requests' && value.status === 'missing'));
        const plan = output.find(value => value.event === 'migration-dry-run');
        assert.equal(plan.mode, 'check-only');
        assert.ok(plan.changes.some(change => change.action === 'create_ledger'));
        assert.ok(plan.changes.some(change => change.column === 'file_mime'));
        assert.equal(f.schemas.employermessages.file_mime, undefined);
        assert.doesNotMatch(JSON.stringify(output), /secret-password|fixture-host|offline_fixture|SELECT|cld:|Bearer/);
        assert.equal(output.at(-1).productionWrites, false);
    } finally { await f.close(); }
});

test('the diagnostic database capability blocks DDL, arbitrary queries and application-row access', async () => {
    const f = fixture();
    try {
        const readOnly = createReadOnlyDatabase(f.database);
        assert.equal(readOnly.sequelize.sync, undefined);
        assert.equal(readOnly.Message.findAll, undefined);
        const qi = readOnly.sequelize.getQueryInterface();
        for (const method of ['addColumn', 'createTable', 'dropTable', 'addIndex', 'bulkInsert', 'bulkDelete']) assert.equal(qi[method], undefined);
        for (const query of ['UPDATE messages SET file_url = NULL', 'DELETE FROM messages', 'ALTER TABLE messages ADD example INT', 'SELECT * FROM messages', 'SELECT DATABASE() AS database_name; DELETE FROM messages']) {
            assert.throws(() => readOnly.sequelize.query(query), { code: 'DIAGNOSTIC_READ_ONLY' });
        }
        assert.throws(() => qi.describeTable('users'), { code: 'DIAGNOSTIC_READ_ONLY' });
        assert.equal(f.reads.length, 0);
    } finally { await f.close(); }
});

test('schema logs omit enum labels, defaults and arbitrary type strings', async () => {
    const f = fixture(), output = [];
    f.schemas.employermessages.senderType = { type: "ENUM('private-user-data')", defaultValue: 'secret-password' };
    f.schemas.messages.file_name = { type: 'private-user-data' };
    try {
        await diagnose(f.database, value => output.push(value));
        assert.equal(output.find(value => value.table === 'employermessages').columnTypes.senderType, 'ENUM');
        assert.doesNotMatch(JSON.stringify(output), /private-user-data|secret-password/);
    } finally { await f.close(); }
});

test('shared participant uniqueness does not become incorrect per-user/per-conversation constraints', async () => {
    const f = fixture(), output = [];
    const participant = f.database.ConversationParticipant;
    participant.rawAttributes.conversation_id.unique = 'shared_participant_key';
    participant.rawAttributes.user_id.unique = 'shared_participant_key';
    try {
        await diagnose(f.database, value => output.push(value));
        const indexes = output.find(value => value.table === 'conversationparticipants').missingIndexes;
        assert.equal(indexes.some(index => index.unique && index.fields.length === 1 && ['user_id', 'conversation_id'].includes(index.fields[0])), false);
    } finally { await f.close(); }
});

test('only valid prefixed diagnostic JSON is forwarded from child output', async () => {
    const child = new EventEmitter(); child.stdout = new EventEmitter();
    const output = [];
    const task = diagnoseBeforeStart(() => child, 1000, line => output.push(line));
    child.stdout.emit('data', Buffer.from('raw secret-password-never-print\n[messaging-schema-dia'));
    child.stdout.emit('data', Buffer.from('gnostic] {"event":"begin","mode":"read-only"}\n[messaging-schema-diagnostic] broken-json\n'));
    child.stdout.emit('data', Buffer.from('[messaging-schema-diagnostic] {"event":"unknown","message":"secret-password-never-print"}\n'));
    child.emit('close', 0);
    await task;
    assert.equal(output.length, 2);
    assert.match(output[0], /"event":"begin"/);
    assert.doesNotMatch(output.join('\n'), /secret-password|broken-json|unknown/);
});

test('normal backend starts exactly once after successful, failed, unavailable or timed-out diagnostics', async () => {
    for (const outcome of ['success', 'nonzero', 'error', 'throw', 'timeout']) {
        const calls = [];
        let server;
        const spawn = (executable, args, options) => {
            calls.push({ args, options });
            const child = new EventEmitter(); child.kill = () => {};
            if (/server\.js$/.test(args[0])) { server = child; return child; }
            if (outcome === 'throw') throw new Error('private spawn exception');
            if (outcome !== 'timeout') queueMicrotask(() => outcome === 'error' ? child.emit('error', new Error('private spawn exception')) : child.emit('close', outcome === 'success' ? 0 : 1));
            return child;
        };
        assert.equal(await startBackend({ spawn, timeoutMs: 15, log: () => {} }), server);
        assert.equal(calls.length, 2);
        assert.match(calls[1].args[0], /server\.js$/);
        assert.equal(calls[1].options.env, process.env);
        assert.equal(calls[1].options.stdio, 'inherit');
    }
});

test('shutdown during the diagnostic does not restart the backend', async () => {
    let spawns = 0;
    const spawn = () => { spawns++; const child = new EventEmitter(); queueMicrotask(() => child.emit('close', 0)); return child; };
    assert.equal(await startBackend({ spawn, log: () => {}, shouldStart: () => false }), null);
    assert.equal(spawns, 1);
});

test('a real failing diagnostic child cannot leak raw output or prevent the backend process starting', async () => {
    const logs = [];
    let backendOutput = '', closed;
    const spawn = (executable, args, options) => {
        if (/diagnoseMessagingSchema\.js$/.test(args[0])) return spawnChild(executable, ['-e', `
            console.log('RAW secret-password-never-print');
            console.error('RAW Bearer private-token-never-print');
            console.log('[messaging-schema-diagnostic] '+JSON.stringify({event:'begin',mode:'read-only',apply:false}));
            process.exitCode=1;
        `], options);
        return spawnChild(executable, ['-e', "process.stdout.write('fixture-backend-started');"], { ...options, stdio: ['ignore', 'pipe', 'ignore'] });
    };
    await startBackend({ spawn, timeoutMs: 10000, log: line => logs.push(line), onServer: server => {
        server.stdout.on('data', chunk => { backendOutput += String(chunk); });
        closed = once(server, 'close');
    } });
    const [code] = await closed;
    assert.equal(code, 0);
    assert.equal(backendOutput, 'fixture-backend-started');
    assert.ok(logs.some(line => line.includes('"event":"begin"')));
    assert.ok(logs.some(line => line.includes('diagnostic_failed')));
    assert.doesNotMatch(logs.join('\n'), /secret-password|private-token|RAW/);
});

test('unsupported schemas require review without mutations or raw exceptions', async () => {
    const f = fixture(), output = [];
    delete f.schemas.messages.conversation_id;
    try {
        await diagnose(f.database, value => output.push(value));
        assert.equal(output.find(value => value.event === 'migration-dry-run').status, 'manual_schema_review_required');
        assert.equal(output.at(-1).event, 'complete');
    } finally { await f.close(); }
});

test('startup continues after diagnostic success, nonzero exit, spawn failure and timeout', async () => {
    for (const outcome of ['success', 'nonzero', 'error', 'throw', 'timeout']) {
        let killed = false;
        const logs = [];
        const spawn = (_executable, args, options) => {
            assert.equal(args.length, 1);
            assert.match(args[0], /diagnoseMessagingSchema\.js$/);
            assert.doesNotMatch(args.join(' '), /--apply/);
            assert.equal(options.stdio[2], 'ignore');
            if (outcome === 'throw') throw new Error('secret-password-never-print');
            const child = new EventEmitter();
            child.kill = () => { killed = true; };
            if (outcome !== 'timeout') queueMicrotask(() => outcome === 'error' ? child.emit('error', new Error('secret-password-never-print')) : child.emit('close', outcome === 'success' ? 0 : 1));
            return child;
        };
        await diagnoseBeforeStart(spawn, 15, line => logs.push(line));
        assert.equal(logs.length, 1);
        assert.match(logs[0], /"backendWillStart":true/);
        assert.doesNotMatch(logs[0], /secret-password/);
        assert.equal(killed, outcome === 'timeout');
    }
});
