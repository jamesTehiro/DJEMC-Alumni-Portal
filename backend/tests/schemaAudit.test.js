const test = require('node:test');
const assert = require('node:assert/strict');
const { Sequelize, DataTypes } = require('sequelize');
const { compareModel, compatibleType, expectedModel } = require('../utils/schemaAudit');
const { audit } = require('../scripts/auditDatabaseSchema');
const expected = () => ({ model: 'Job', table: 'jobs', columns: [{ name: 'id', type: 'INTEGER', allowNull: false, primaryKey: true, autoIncrement: true }, { name: 'title', type: 'VARCHAR(255)', allowNull: true, primaryKey: false, autoIncrement: false }], indexes: [] });
const actual = () => ({ name: 'jobs', columns: [{ name: 'id', type: 'int(11)', allowNull: false, primaryKey: true, autoIncrement: true }, { name: 'title', type: 'varchar(255)', allowNull: true, primaryKey: false, autoIncrement: false }], indexes: [], foreignKeys: [] });
test('schema audit handles MySQL integer widths, enum whitespace and MariaDB JSON storage without false positives', () => {
 assert.equal(compatibleType('INTEGER', 'int(11)'), true);
 assert.equal(compatibleType("ENUM('pending', 'sent')", "enum('pending','sent')"), true);
 assert.equal(compatibleType('JSON', 'longtext'), true);
 assert.equal(compatibleType("ENUM('a, b')", "enum('a,b')"), false);
 assert.equal(compatibleType('VARCHAR(500)', 'varchar(255)'), false);
 const result = compareModel(expected(), [actual()]); assert.deepEqual(result.columnDifferences, []);
});
test('schema audit distinguishes exact table casing and missing tables without assuming lowercase exists', () => {
 const row = actual(); row.name = 'Jobs';
 const r = compareModel(expected(), [row]); assert.equal(r.actualTable, null); assert.equal(r.missingTable, true); assert.deepEqual(r.caseVariants, ['Jobs']);
 const absent = compareModel(expected(), []); assert.equal(absent.actualTable, null); assert.deepEqual(absent.caseVariants, []);
});
test('schema audit flags missing columns, type/null/primary-key/auto-increment differences', () => {
 const row = actual(); row.columns[0] = { name: 'id', type: 'bigint', allowNull: true, primaryKey: false, autoIncrement: false }; row.columns.pop();
 const r = compareModel(expected(), [row]); assert.deepEqual(r.missingColumns, ['title']); assert.equal(r.columnDifferences.length, 4);
});
test('schema audit checks full index and exact foreign-key target/delete rule without changing them', () => {
 const want = expected(); want.indexes = [{ name: 'title_uq', fields: ['title'], unique: true }]; want.columns[1].references = { table: 'users', column: 'id', onDelete: 'RESTRICT' };
 const row = actual(); row.indexes = [{ name: 'prefix_uq', fields: ['title'], unique: true, prefix: true }]; row.foreignKeys = [{ column: 'title', targetTable: 'Users', targetColumn: 'id', onDelete: 'CASCADE' }];
 const r = compareModel(want, [row]); assert.equal(r.missingIndexes.length, 1); assert.equal(r.foreignKeyDifferences.length, 1);
 row.indexes[0].prefix = false; row.foreignKeys[0].targetTable = 'users'; row.foreignKeys[0].onDelete = 'RESTRICT';
 assert.equal(compareModel(want, [row]).missingIndexes.length, 0); assert.equal(compareModel(want, [row]).foreignKeyDifferences.length, 0);
});
function fixture() {
 const sequelize = new Sequelize('unused', 'unused', 'unused', { dialect: 'mysql', logging: false });
 const Job = sequelize.define('Job', { title: DataTypes.STRING }, { tableName: 'jobs' });
 const generator = sequelize.getQueryInterface().queryGenerator;
 const model = expectedModel(Job, generator);
 const queries = [];
 const db = { Sequelize: { QueryTypes: { SELECT: 'SELECT' } }, sequelize: { models: { Job }, config: { host: 'expected-host' }, authenticate: async () => {}, getQueryInterface: () => ({ queryGenerator: generator }), query: async (sql, options) => {
  queries.push(sql); assert.match(sql, /^SELECT /); assert.equal(options.type, 'SELECT');
  if (sql.startsWith('SELECT DATABASE()')) return [{ database_name: 'expected_db', server_hostname: 'expected-server', server_port: 3306, lower_case_table_names: 0 }];
  if (sql.includes('information_schema.TABLES')) return [{ name: 'jobs' }];
  if (sql.includes('information_schema.COLUMNS')) return model.columns.map(c => ({ table_name: 'jobs', name: c.name, type: c.type, nullable: c.allowNull ? 'YES' : 'NO', column_key: c.primaryKey ? 'PRI' : '', extra: c.autoIncrement ? 'auto_increment' : '' }));
  if (sql.includes('information_schema.STATISTICS') || sql.includes('information_schema.KEY_COLUMN_USAGE')) return [];
  assert.match(sql, /^SELECT .* FROM `jobs` WHERE 1 = 0$/); return [];
 } } };
 return { sequelize, db, queries, model };
}
test('model snapshot normalizes implicit primary-key nullability and preserves timestamp names', async () => {
 const f = fixture(); try { assert.equal(f.model.columns.find(c => c.name === 'id').allowNull, false); assert.equal(f.model.timestamps.createdAt, 'createdAt'); } finally { await f.sequelize.close(); }
});
test('full audit is SELECT-only, reads no records, validates identity and verifies modeled column resolution', async () => {
 const f = fixture(); try {
  const r = await audit(f.db, { database: 'expected_db', host: 'expected-host' });
  assert.equal(r.intendedTargetVerified, true); assert.equal(r.comparisons[0].queryVerified, true); assert.deepEqual(r.comparisons[0].missingColumns, []); assert.equal(r.migrationLedger.available, false); assert.equal(f.queries.length, 6);
 } finally { await f.sequelize.close(); }
});
test('full audit refuses an unexpected target before inventory queries', async () => {
 const f = fixture(); try { await assert.rejects(audit(f.db, { database: 'different_db', host: 'expected-host' }), /target does not match/); assert.equal(f.queries.length, 1); } finally { await f.sequelize.close(); }
});

test('foreign keys pointing at a different database are reported for review', () => {
 const want = expected(); want.database = 'intended_db'; want.columns[1].references = { table: 'users', column: 'id' };
 const row = actual(); row.foreignKeys = [{ column: 'title', targetTable: 'users', targetColumn: 'id', targetDatabase: 'different_db' }];
 assert.equal(compareModel(want, [row]).foreignKeyDifferences.length, 1);
});
