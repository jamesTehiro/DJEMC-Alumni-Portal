const test = require('node:test');
const assert = require('node:assert/strict');
const Sequelize = require('sequelize');
const migration = require('../migrations/20261016-repair-email-queue-dedupe-key');
function fixture({ column = false, indexes = [], duplicates = 0, tables = ['email_queue_jobs'] } = {}) {
 const calls = [], columns = { id: { type: 'INTEGER' }, status: { type: 'ENUM' } };
 if (column) columns.dedupe_key = column === true ? { type: 'VARCHAR(191)', allowNull: true } : column;
 const qi = {
  showAllTables: async () => tables, describeTable: async table => { assert.equal(table, 'email_queue_jobs'); return columns; }, showIndex: async () => indexes,
  addColumn: async (table, field, definition) => { calls.push(['addColumn', table, field]); assert.equal(definition.type.toString(), 'VARCHAR(191)'); assert.equal(definition.allowNull, true); assert.equal(definition.defaultValue, null); columns[field] = { type: 'VARCHAR(191)', allowNull: true }; },
  addIndex: async (table, fields, options) => { calls.push(['addIndex', table, fields]); assert.deepEqual(fields, ['dedupe_key']); assert.equal(options.unique, true); indexes.push({ ...options, fields: [{ attribute: 'dedupe_key' }] }); },
  sequelize: { query: async (sql, options) => { assert.match(sql, /^SELECT /); assert.match(sql, /WHERE `dedupe_key` IS NOT NULL/); assert.match(sql, /GROUP BY `dedupe_key` HAVING COUNT\(\*\) > 1/); assert.equal(options.type, Sequelize.QueryTypes.SELECT); return [{ duplicate_groups: duplicates }]; } }
 };
 return { qi, calls, columns, indexes };
}
test('repair migration adds only nullable VARCHAR(191) and full unique index, preserving other columns', async () => {
 const f = fixture(); await migration.up(f.qi, Sequelize);
 assert.deepEqual(f.calls.map(c => c[0]), ['addColumn', 'addIndex']);
 assert.deepEqual(f.columns.id, { type: 'INTEGER' }); assert.deepEqual(f.columns.status, { type: 'ENUM' });
 await migration.up(f.qi, Sequelize); assert.equal(f.calls.length, 2);
});
test('existing compatible column gets only its missing unique index', async () => {
 const f = fixture({ column: true }); await migration.up(f.qi, Sequelize); assert.deepEqual(f.calls.map(c => c[0]), ['addIndex']);
});
test('multiple NULL keys are excluded from duplicate detection', async () => {
 const f = fixture({ column: true }); const status = await migration.inspect(f.qi, Sequelize); assert.equal(status.duplicateGroups, 0);
});
test('duplicate non-NULL groups stop before mutation without disclosing keys or deleting records', async () => {
 const f = fixture({ column: true, duplicates: 2 }); await assert.rejects(migration.up(f.qi, Sequelize), /Duplicate non-NULL.*\(2\)/); assert.deepEqual(f.calls, []);
});
test('incompatible columns and wrongly named indexes require manual review', async () => {
 for (const options of [{ column: { type: 'VARCHAR(100)', allowNull: true } }, { column: { type: 'VARCHAR(191)', allowNull: false } }, { column: true, indexes: [{ name: 'email_queue_jobs_dedupe_key_uq', unique: false, fields: [{ attribute: 'dedupe_key' }] }] }]) {
  const f = fixture(options); await assert.rejects(migration.up(f.qi, Sequelize)); assert.deepEqual(f.calls, []);
 }
});
test('equivalent existing full unique index is reused, while a prefix index does not qualify', async () => {
 const f = fixture({ column: true, indexes: [{ name: 'legacy_unique_key', unique: true, fields: [{ attribute: 'dedupe_key' }] }] }); await migration.up(f.qi, Sequelize); assert.deepEqual(f.calls, []);
 const prefix = fixture({ column: true, indexes: [{ name: 'prefix_key', unique: true, fields: [{ attribute: 'dedupe_key', length: 12 }] }] }); await migration.up(prefix.qi, Sequelize); assert.equal(prefix.calls[0][0], 'addIndex');
});
test('missing or capitalized-only table never triggers table creation', async () => {
 const f = fixture({ tables: ['Email_Queue_Jobs'] }); await assert.rejects(migration.up(f.qi, Sequelize), /exact lowercase/); assert.deepEqual(f.calls, []);
});
test('rollback refuses to drop keys or constraints', async () => { await assert.rejects(migration.down(), /rollback is disabled/); });

const { run } = require('../scripts/applyEmailQueueDedupeMigration');
function runnerFixture(options) {
 const f = fixture(options); const originalQuery = f.qi.sequelize.query; let authenticated = false;
 f.qi.sequelize.query = async (sql, opts) => {
  if (sql.startsWith('SELECT DATABASE()')) return [{ database_name: 'expected_db' }];
  if (sql.includes('information_schema.COLUMNS')) return Object.keys(f.columns).map(column_name => ({ table_name: 'email_queue_jobs', column_name }));
  return originalQuery(sql, opts);
 };
 const db = { sequelize: { ...f.qi.sequelize, config: { host: 'expected-host', database: 'expected_db' }, authenticate: async () => { authenticated = true; }, getQueryInterface: () => f.qi, models: { EmailQueueJob: { name: 'EmailQueueJob', getTableName: () => 'email_queue_jobs', rawAttributes: { id: { field: 'id' }, dedupe_key: { field: 'dedupe_key' } } } } } };
 return { ...f, db, authenticated: () => authenticated };
}
test('runner defaults to read-only schema inspection even when the column is missing', async () => {
 const f = runnerFixture(); await run(f.db, []); assert.equal(f.authenticated(), true); assert.deepEqual(f.calls, []);
});
test('runner refuses apply without explicit identity or when the connected database/host differs', async () => {
 const f = runnerFixture(); await assert.rejects(run(f.db, ['--apply']), /requires/); assert.equal(f.authenticated(), false);
 await assert.rejects(run(f.db, ['--apply', '--database', 'wrong_db', '--host', 'expected-host']), /identity/);
 await assert.rejects(run(f.db, ['--apply', '--database', 'expected_db', '--host', 'wrong-host']), /identity/);
 assert.deepEqual(f.calls, []);
});
test('runner applies only the targeted additive migration after identity verification', async () => {
 const f = runnerFixture(); await run(f.db, ['--apply', '--database', 'expected_db', '--host', 'expected-host']);
 assert.deepEqual(f.calls.map(c => c[0]), ['addColumn', 'addIndex']); assert.ok(f.calls.every(c => c[1] === 'email_queue_jobs'));
});

test('duplicate check runs again after adding a missing column before attempting uniqueness', async () => {
 const f = fixture({ duplicates: 1 }); await assert.rejects(migration.up(f.qi, Sequelize), /appeared before index/);
 assert.deepEqual(f.calls.map(c => c[0]), ['addColumn']);
});
