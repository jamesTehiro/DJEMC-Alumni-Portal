const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../scripts/checkModelTableMappings'), 'utf8');
async function audit(tables, deniedTable) {
 const queries = [], output = [], runtime = {};
 let closed = false;
 const models = { Job: { name: 'Job', getTableName: () => 'jobs' }, EmploymentHistory: { name: 'EmploymentHistory', getTableName: () => 'employmenthistories' } };
 const db = { Sequelize: { QueryTypes: { SELECT: 'SELECT' } }, sequelize: {
  models, config: { host: 'example.invalid', port: 3306, database: 'defaultdb' }, authenticate: async () => {}, close: async () => { closed = true; },
  getQueryInterface: () => ({ queryGenerator: { quoteTable: table => '`' + table + '`' } }),
  query: async sql => {
   queries.push(sql);
   assert.match(sql, /^SELECT /);
   if (sql.includes('DATABASE() AS')) return [{ database_name: 'defaultdb', server_hostname: 'expected-server', server_port: 3306, lower_case_table_names: 0 }];
   if (sql.includes('information_schema.TABLES')) return tables.map(table_name => ({ table_name }));
   assert.match(sql, /^SELECT 1 FROM `[a-z]+` WHERE 1 = 0$/);
   if (deniedTable && sql.includes('`' + deniedTable + '`')) throw Object.assign(new Error('denied'), { original: { code: 'ER_TABLEACCESS_DENIED_ERROR' } });
   return [];
  }
 } };
 await vm.runInNewContext(source, { require: name => { assert.equal(name, '../models'); return db; }, process: runtime, console: { log: text => output.push(JSON.parse(text)), error: () => {} } });
 assert.equal(closed, true);
 return { queries, output, runtime };
}
test('table audit verifies exact names and SELECT access without reading or changing rows', async () => {
 const result = await audit(['jobs', 'employmenthistories']);
 assert.equal(result.runtime.exitCode, undefined);
 assert.equal(result.queries.length, 4);
 assert.ok(result.output[1].mappings.every(m => m.exists_exactly && m.query_ok));
 assert.equal(result.output[0].connected.database_name, 'defaultdb');
});
test('table audit rejects capitalized-only tables on a case-sensitive production schema', async () => {
 const result = await audit(['Jobs', 'employmenthistories']);
 assert.equal(result.runtime.exitCode, 1);
 assert.equal(result.output[1].mappings[0].exists_exactly, false);
 assert.deepEqual(Array.from(result.output[1].mappings[0].case_variants), ['Jobs']);
 assert.equal(result.queries.some(sql => sql.includes('FROM `jobs`')), false);
});
test('table audit returns failure when an existing table cannot be queried', async () => {
 const result = await audit(['jobs', 'employmenthistories'], 'jobs');
 assert.equal(result.runtime.exitCode, 1);
 assert.equal(result.output[1].mappings[0].query_ok, false);
 assert.equal(result.output[1].mappings[0].query_error, 'ER_TABLEACCESS_DENIED_ERROR');
 assert.equal(result.output[1].mappings[1].query_ok, true);
});
