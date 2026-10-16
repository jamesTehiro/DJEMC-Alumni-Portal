'use strict';
const { expectedModel, compareModel } = require('../utils/schemaAudit');
const { membershipReadSchema } = require('../utils/membershipSchemaAudit');
async function audit(db, options = {}) {
 await db.sequelize.authenticate();
 const select = sql => db.sequelize.query(sql, { type: db.Sequelize.QueryTypes.SELECT });
 const [identity] = await select('SELECT DATABASE() AS database_name, @@hostname AS server_hostname, @@port AS server_port, @@lower_case_table_names AS lower_case_table_names');
 if ((options.database && identity.database_name !== options.database) || (options.host && db.sequelize.config.host !== options.host)) throw new Error('Audit target does not match expected host/database. No schema changes were performed.');
 const tables = await select('SELECT TABLE_NAME AS name, ENGINE AS engine, TABLE_COLLATION AS collation FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()');
 const columns = await select('SELECT TABLE_NAME AS table_name, COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable, COLUMN_KEY AS column_key, EXTRA AS extra, COLUMN_DEFAULT AS default_value, COLLATION_NAME AS collation FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()');
 const indexRows = await select('SELECT TABLE_NAME AS table_name, INDEX_NAME AS name, NON_UNIQUE AS non_unique, SEQ_IN_INDEX AS position, COLUMN_NAME AS column_name, SUB_PART AS prefix FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX');
 const foreignKeys = await select('SELECT k.TABLE_NAME AS table_name, k.COLUMN_NAME AS column_name, k.REFERENCED_TABLE_NAME AS target_table, k.REFERENCED_COLUMN_NAME AS target_column, k.REFERENCED_TABLE_SCHEMA AS target_schema, r.UPDATE_RULE AS update_rule, r.DELETE_RULE AS delete_rule FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.TABLE_NAME = k.TABLE_NAME AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME WHERE k.TABLE_SCHEMA = DATABASE() AND k.REFERENCED_TABLE_NAME IS NOT NULL');
 const inventory = tables.map(t => {
  const groups = new Map();
  for (const row of indexRows.filter(i => i.table_name === t.name)) {
   if (!groups.has(row.name)) groups.set(row.name, { name: row.name, unique: Number(row.non_unique) === 0, fields: [], prefix: false });
   const group = groups.get(row.name); group.fields.push(row.column_name); group.prefix ||= row.prefix != null;
  }
  return { ...t, columns: columns.filter(c => c.table_name === t.name).map(c => ({ name: c.name, type: c.type, allowNull: c.nullable === 'YES', primaryKey: c.column_key === 'PRI', autoIncrement: /auto_increment/i.test(c.extra), defaultValue: c.default_value, collation: c.collation })), indexes: [...groups.values()], foreignKeys: foreignKeys.filter(k => k.table_name === t.name).map(k => ({ column: k.column_name, targetTable: k.target_table, targetColumn: k.target_column, targetDatabase: k.target_schema, onDelete: k.delete_rule, onUpdate: k.update_rule })) };
 });
 const generator = db.sequelize.getQueryInterface().queryGenerator;
 const expected = Object.values(db.sequelize.models).map(m => ({ ...expectedModel(m, generator), database: identity.database_name }));
 const comparisons = expected.map(e => compareModel(e, inventory));
 for (let i = 0; i < comparisons.length; i++) {
  const item = comparisons[i];
  if (item.missingTable || item.missingColumns.length) continue;
  try { await select(`SELECT ${expected[i].columns.map(c => generator.quoteIdentifier(c.name)).join(', ')} FROM ${generator.quoteTable(item.expectedTable)} WHERE 1 = 0`); item.queryVerified = true; }
  catch (e) { item.queryError = e.original?.code || e.name; }
 }
 const ledger = tables.find(t => t.name.toLowerCase() === 'sequelizemeta');
 let migrationLedger = { available: false, applied: [] };
 if (ledger && inventory.find(t => t.name === ledger.name).columns.some(c => c.name === 'name')) {
  try {
   const rows = await select(`SELECT name FROM ${generator.quoteTable(ledger.name)}`);
   migrationLedger = { available: true, applied: rows.map(r => r.name) };
  } catch (error) { migrationLedger = { available: false, applied: [], error: error.original?.code || error.name }; }
 }
 const migrationFiles = require('fs').readdirSync(require('path').join(__dirname, '../migrations')).filter(name => name.endsWith('.js')).sort();
 migrationLedger.repository = migrationFiles;
 migrationLedger.notRecorded = migrationLedger.available ? migrationFiles.filter(name => !migrationLedger.applied.includes(name)) : null;
 migrationLedger.warning = 'Unrecorded migrations are not proof of missing schema; never replay automatically.';
 const revision = process.env.RENDER_GIT_COMMIT || '';
 return { version: 1, generatedAt: new Date().toISOString(), environment: process.env.NODE_ENV || 'development', commit: /^[a-f0-9]{7,64}$/i.test(revision) ? revision : 'unknown', intendedTargetVerified: !!(options.host && options.database), identity, expected, inventory, comparisons, membershipReadSchema: membershipReadSchema(expected, inventory), migrationLedger };
}
if (require.main === module) {
 const db = require('../models'); const args = process.argv.slice(2); const value = flag => { const i = args.indexOf(flag); return i < 0 ? undefined : args[i + 1]; };
 audit(db, { database: value('--database'), host: value('--host') }).then(result => {
  console.log('SCHEMA_AUDIT_IDENTITY', JSON.stringify({ environment: result.environment, commit: result.commit, intendedTargetVerified: result.intendedTargetVerified, ...result.identity }));
  for (const row of result.comparisons) console.log('SCHEMA_AUDIT_MODEL', JSON.stringify(row));
  console.log('SCHEMA_AUDIT_MEMBERSHIP', JSON.stringify(result.membershipReadSchema));
  console.log('SCHEMA_AUDIT_MIGRATIONS', JSON.stringify(result.migrationLedger));
  if (value('--output')) { const fs = require('fs'); fs.writeFileSync(value('--output'), JSON.stringify(result, null, 2)); }
  if (args.includes('--strict') && result.comparisons.some(c => !c.queryVerified || c.columnDifferences.length || c.missingIndexes.length || c.foreignKeyDifferences.length)) process.exitCode = 1;
 }).catch(error => { console.error('SCHEMA_AUDIT_FAILED', error.original?.code || error.name); console.error('Read-only audit did not complete. Verify the expected target, permissions and connection privately.'); process.exitCode = 1; }).finally(() => db.sequelize.close());
}
module.exports = { audit };
