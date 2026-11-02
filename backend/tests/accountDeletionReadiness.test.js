const test = require('node:test');
const assert = require('node:assert/strict');
const { inspect, TABLE, INDEX } = require('../services/accountDeletionSchema');
const columns = () => Object.fromEntries(Object.entries({ id: 'INT', reference: 'TEXT', status: 'VARCHAR(24)', attempts: 'INT', next_attempt_at: 'DATETIME', last_error: 'VARCHAR(80)', createdAt: 'DATETIME', updatedAt: 'DATETIME' })
    .map(([key, type]) => [key, { type, allowNull: key === 'last_error', ...(key === 'id' && { primaryKey: true, autoIncrement: true }), ...(key === 'status' && { defaultValue: 'pending' }), ...(key === 'attempts' && { defaultValue: 0 }) }]));
const qi = () => ({ showAllTables: async () => [TABLE], describeTable: async () => columns(),
    showIndex: async () => [{ name: INDEX, unique: false, fields: [{ attribute: 'status' }, { attribute: 'next_attempt_at' }] }],
    sequelize: { query: async () => [{ engine: 'InnoDB' }] } });
test('readiness checks exact columns, engine, primary key and complete due index', async () => {
    const query = qi(); assert.equal((await inspect(query)).ready, true);
    query.showIndex = async () => []; assert.deepEqual((await inspect(query)).issues, ['cleanup_due_index_missing']);
    query.showIndex = async () => [{ name: INDEX, unique: false, fields: [{ attribute: 'status' }] }];
    assert.ok((await inspect(query)).issues.includes('conflicting_due_index'));
    query.describeTable = async () => ({ ...columns(), status: { type: 'VARCHAR(12)', allowNull: false } });
    query.sequelize.query = async () => [{ engine: 'MyISAM' }];
    const bad = await inspect(query);
    assert.ok(bad.issues.includes('incompatible_column:status')); assert.ok(bad.issues.includes('nontransactional_engine'));
});

test('migration repairs an interrupted index creation without recreating or deleting data', async () => {
    const migration = require('../migrations/20261102-create-account-deletion-files');
    const query = qi(); let indexed = false, changes = 0;
    query.createTable = async () => assert.fail('Existing table must not be recreated');
    query.showIndex = async () => indexed ? [{ name: INDEX, unique: false, fields: [{ attribute: 'status' }, { attribute: 'next_attempt_at' }] }] : [];
    query.addIndex = async (name, fields, options) => { assert.equal(name, TABLE); assert.deepEqual(fields, ['status', 'next_attempt_at']); assert.equal(options.name, INDEX); indexed = true; changes++; };
    await migration.up(query, {}); await migration.up(query, {});
    assert.equal(changes, 1);
    query.describeTable = async () => ({ ...columns(), reference: { type: 'VARCHAR(20)', allowNull: false } });
    await assert.rejects(migration.up(query, {}), /incompatible/); assert.equal(changes, 1);
});

test('worker configuration requires supported storage before consuming any cleanup attempts', () => {
    const { inspectConfiguration } = require('../services/accountDeletionWorkerConfig');
    assert.equal(inspectConfiguration({}).storageConfigured, false);
    const configured = { CLOUDINARY_CLOUD_NAME: 'fixture', CLOUDINARY_API_KEY: 'fixture', CLOUDINARY_API_SECRET: 'fixture' };
    assert.deepEqual(inspectConfiguration(configured), { storageConfigured: true, policyEnabled: false, issues: [] });
    assert.equal(inspectConfiguration({ ...configured, OBJECT_STORAGE_PROVIDER: 'unknown' }).storageConfigured, false);
});

test('read-only remote preflight verifies MySQL version without reading accounts or running DDL', async () => {
    const { check } = require('../scripts/checkAccountDeletionReadiness');
    const queries = [];
    const report = await check({ env: { DB_HOST: '127.0.0.1', DB_NAME: 'fixture', DB_USER: 'fixture' }, connect: async () => ({
        query: async sql => {
            queries.push(sql); assert.match(sql, /^SELECT /);
            if (sql.includes('VERSION()')) return [[{ version: '8.4.11', version_comment: 'MySQL Community Server' }]];
            return [[]];
        }, end: async () => {}
    }) });
    assert.equal(queries.length, 3); assert.equal(report.mysql84, true); assert.equal(report.permanentDeletionEnabled, false);
    assert.equal(report.cleanupTableExists, false); assert.equal(report.deploymentRuntimeVerified, false);
    assert.ok(!JSON.stringify(report).includes('DB_PASS'));
});

test('worker refuses disabled policy before authentication or queue access', async () => {
    const db = require('../models');
    const worker = require('../workers/accountDeletionCleanupWorker');
    const original = db.sequelize.authenticate, policy = process.env.ACCOUNT_DELETION_POLICY;
    delete process.env.ACCOUNT_DELETION_POLICY;
    db.sequelize.authenticate = async () => assert.fail('Disabled worker must not connect');
    try { await assert.rejects(worker.main(), /Approved deletion policy/); }
    finally { db.sequelize.authenticate = original; if (policy === undefined) delete process.env.ACCOUNT_DELETION_POLICY; else process.env.ACCOUNT_DELETION_POLICY = policy; }
});

test('migration and worker remote connections verify the configured CA and identity', () => {
    const { secureConnection } = require('../config/accountDeletionConnection');
    const connection = { config: { host: 'fixture.invalid' }, options: {} };
    secureConnection(connection, {});
    for (const settings of [connection.config, connection.options]) {
        assert.equal(settings.dialectOptions.ssl.rejectUnauthorized, true);
        assert.equal(settings.dialectOptions.ssl.verifyIdentity, true);
        assert.equal(settings.dialectOptions.ssl.minVersion, 'TLSv1.2');
        assert.ok(settings.dialectOptions.ssl.ca.includes('BEGIN CERTIFICATE'));
    }
});

test('production application database configuration verifies CA and server identity without connecting', () => {
    const { execFileSync } = require('node:child_process');
    const path = require('node:path');
    execFileSync(process.execPath, ['-e', `const assert=require('node:assert/strict'); const db=require('./config/database');
        assert.equal(db.options.dialectOptions.ssl.rejectUnauthorized,true);
        assert.equal(db.options.dialectOptions.ssl.verifyIdentity,true);
        assert.ok(db.options.dialectOptions.ssl.ca.includes('BEGIN CERTIFICATE')); db.close();`], {
        cwd: path.join(__dirname, '..'), encoding: 'utf8',
        env: { ...process.env, NODE_ENV: 'production', DB_HOST: 'fixture.invalid', DB_PORT: '3306', DB_NAME: 'fixture', DB_USER: 'fixture', DB_PASS: 'fixture' }
    });
});
