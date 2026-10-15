const test = require('node:test');
const assert = require('node:assert/strict');
const { logJobTableDiagnostics } = require('../utils/jobTableDiagnostics');
function fixture(table = 'jobs', tables = ['jobs']) {
 const output = [], queries = [];
 const db = { Job: { getTableName: () => table }, Sequelize: { QueryTypes: { SELECT: 'SELECT' } }, sequelize: { config: { database: 'configured_db', password: 'SECRET' }, query: async sql => {
  queries.push(sql); assert.match(sql, /^SELECT /);
  return sql.includes('information_schema') ? tables.map(table_name => ({ table_name })) : [{ database_name: 'connected_db' }];
 } } };
 return { db, output, queries, logger: { log: (...args) => output.push(JSON.parse(args[1])) } };
}
test('diagnostic is disabled by default and makes no queries', async () => {
 const f = fixture(); await logJobTableDiagnostics(f.db, {}, f.logger); assert.equal(f.queries.length, 0); assert.equal(f.output.length, 0);
});
test('diagnostic reports deployed revision, actual database and exact lowercase table without secrets', async () => {
 const f = fixture(); await logJobTableDiagnostics(f.db, { JOB_TABLE_DIAGNOSTICS: 'true', RENDER_GIT_COMMIT: 'abcdef1234567890' }, f.logger);
 assert.deepEqual(f.output[0], { commit: 'abcdef1234567890', jobTable: 'jobs', configuredDatabase: 'configured_db', connectedDatabase: 'connected_db', lowercaseJobsExists: true, result: 'mapped-table-present' });
 assert.ok(!JSON.stringify(f.output).includes('SECRET'));
});
test('diagnostic distinguishes stale capitalized models from missing tables in the connected database', async () => {
 for (const [table, tables, result] of [['Jobs', ['jobs'], 'model-table-mismatch'], ['jobs', ['Jobs'], 'lowercase-jobs-missing'], ['jobs', [], 'lowercase-jobs-missing']]) {
  const f = fixture(table, tables); await logJobTableDiagnostics(f.db, { JOB_TABLE_DIAGNOSTICS: 'true' }, f.logger); assert.equal(f.output[0].result, result);
 }
});
test('diagnostic query failures do not stop startup or log raw connection errors', async () => {
 const f = fixture(); f.db.sequelize.query = async () => { throw Object.assign(new Error('SECRET connection URL'), { original: { code: 'ECONNREFUSED' } }); };
 await logJobTableDiagnostics(f.db, { JOB_TABLE_DIAGNOSTICS: 'true' }, f.logger);
 assert.equal(f.output[0].errorCode, 'ECONNREFUSED'); assert.ok(!JSON.stringify(f.output).includes('SECRET'));
});
