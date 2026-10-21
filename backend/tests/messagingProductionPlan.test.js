const test = require('node:test');
const assert = require('node:assert/strict');
const { run, guardedApply, validateProductionPlan } = require('../scripts/repairMessagingStorage');

test('production plan accepts only the reviewed changes and safe partial reruns', () => {
    const plan = [{ action: 'widen', table: 'messages', column: 'file_url' }, { action: 'widen', table: 'employermessages', column: 'attachment' }, { action: 'create_ledger', table: 'message_send_requests' }];
    for (const state of [plan, plan.slice(1), plan.slice(2), []]) assert.doesNotThrow(() => validateProductionPlan(state));
    for (const extra of [{ action: 'add', table: 'messages', column: 'file_mime' }, { action: 'widen', table: 'users', column: 'name' }, { action: 'drop', table: 'messages' }]) assert.throws(() => validateProductionPlan([...plan, extra]), /reviewed three-change/);
});

test('production-plan dry run uses only SELECT/schema reads and refuses engine/version drift', async () => {
    const fields = {
        messages: ['id','conversation_id','sender_id','message_text','is_read','createdAt','updatedAt','file_url','file_name','file_mime','file_size'],
        employermessages: ['id','conversationId','senderType','senderId','message','createdAt','updatedAt','attachment','file_name','file_mime','file_size'],
        conversations: ['id','conversation_key','type','last_message_text','last_message_at'], employerconversations: ['id','employerId','adminId','last_message_text','last_message_at'],
        conversationparticipants: ['conversation_id','user_id','unread_count','last_read_at']
    };
    const queries = [], output = [];
    let engine = 'InnoDB', version = '8.4.11';
    const schemas = Object.fromEntries(Object.entries(fields).map(([table, columns]) => [table, Object.fromEntries(columns.map(column => [column, { type: ['file_url','attachment'].includes(column) ? 'TEXT' : 'INTEGER' }]))]));
    const db = { sequelize: { config: { host: 'fixture-remote' }, authenticate: async () => {}, getQueryInterface: () => ({
        showAllTables: async () => Object.keys(schemas), describeTable: async table => schemas[table], showIndex: async () => []
    }), query: async sql => {
        assert.match(sql, /^SELECT /); queries.push(sql);
        return sql.includes('database_name') ? [{ database_name: 'fixture' }] : sql.includes('server_version') ? [{ server_version: version }] : Object.keys(schemas).map(table_name => ({ table_name, engine }));
    } } };
    await run(db, ['--production-plan'], line => output.push(JSON.parse(line)));
    assert.equal(output[0].mode, 'check-only');
    assert.deepEqual(output[0].changes, [{ action: 'create_ledger', table: 'message_send_requests' }]);
    engine = 'MyISAM'; await assert.rejects(run(db, ['--production-plan'], () => {}), /requires InnoDB/);
    engine = 'InnoDB'; version = '5.7.44'; await assert.rejects(run(db, ['--production-plan'], () => {}), /actual MySQL major version/);
    assert.equal(queries.some(sql => /SET|GET_LOCK|ALTER|CREATE/.test(sql)), false);
});

function fixture(acquired = 1) {
    const connection = {}, queries = [];
    let released = false, destroyed = false;
    const sequelize = {
        query: async (sql, options) => {
            assert.equal(options.connection, connection);
            queries.push({ sql, options });
            if (sql.includes('@@SESSION')) return [{ lock_wait_timeout: 86400 }];
            if (sql.includes('GET_LOCK')) return [{ acquired }];
            return [];
        },
        connectionManager: { getConnection: async () => connection, releaseConnection: async c => { assert.equal(c, connection); released = true; }, destroyConnection: async () => { destroyed = true; } },
        getQueryInterface: () => ({ sequelize, nestedDDL() { return this.sequelize.query('fixture DDL'); } })
    };
    return { db: { sequelize }, queries, released: () => released, destroyed: () => destroyed };
}

test('migration advisory lock, timeout and nested DDL use one pinned connection', async () => {
    const f = fixture();
    await guardedApply(f.db, 'private-database-never-log', 15, qi => qi.nestedDDL());
    assert.ok(f.queries.some(q => q.sql === 'fixture DDL'));
    assert.ok(f.queries.some(q => q.sql.includes('RELEASE_LOCK')));
    assert.deepEqual(f.queries.filter(q => q.sql.startsWith('SET')).map(q => q.options.replacements.seconds), [15, 86400]);
    assert.equal(f.released(), true);
    assert.doesNotMatch(JSON.stringify(f.queries), /private-database-never-log/);
});

test('busy advisory lock stops before DDL and failures release the lock without suppressing the original error', async () => {
    const busy = fixture(0);
    await assert.rejects(guardedApply(busy.db, 'fixture', 15, () => assert.fail('DDL must not run')), /Another messaging migration/);
    const failed = fixture();
    await assert.rejects(guardedApply(failed.db, 'fixture', 15, async () => { throw new Error('fixture failure'); }), /fixture failure/);
    assert.ok(failed.queries.some(q => q.sql.includes('RELEASE_LOCK')));
    assert.equal(failed.released(), true);
});

test('remote production CLI verifies the CA and hostname before connecting and sanitizes failures', async () => {
    const source = require('node:fs').readFileSync(require.resolve('../scripts/repairMessagingStorage'), 'utf8');
    const output = [], scriptModule = { exports: {} };
    const cliProcess = { argv: ['node', 'repairMessagingStorage.js', '--production-plan'], env: { NODE_ENV: 'production', MIGRATION_DB_CA_FILE: 'private-ca-path' } };
    let closed;
    const done = new Promise(resolve => { closed = resolve; });
    const sequelize = { config: { host: 'fixture-remote', dialectOptions: {} }, options: { dialectOptions: {} },
        authenticate: async () => {
            for (const settings of [sequelize.config, sequelize.options]) assert.deepEqual({ ...settings.dialectOptions.ssl },
                { ca: 'fixture-ca', rejectUnauthorized: true, verifyIdentity: true, minVersion: 'TLSv1.2' });
            throw Object.assign(new Error('private-password private-message connection-url'), { code: 'ER_ACCESS_DENIED_ERROR' });
        }, close: async () => closed() };
    const loader = name => name === '../models' ? { sequelize } : name === 'node:fs' ? { readFileSync: () => 'fixture-ca' } : require(name);
    loader.main = scriptModule;
    require('node:vm').runInNewContext(source, { require: loader, module: scriptModule, process: cliProcess, console: { error: (...args) => output.push(JSON.stringify(args)), log: () => assert.fail('No successful plan expected') } });
    await done;
    assert.equal(cliProcess.exitCode, 1);
    assert.match(output.join(''), /ER_ACCESS_DENIED_ERROR/);
    assert.doesNotMatch(output.join(''), /private-password|private-message|connection-url|private-ca-path/);
});
