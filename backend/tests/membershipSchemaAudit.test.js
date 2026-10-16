const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../models');
const { expectedModel } = require('../utils/schemaAudit');
const { membershipReadSchema } = require('../utils/membershipSchemaAudit');
const generator = db.sequelize.getQueryInterface().queryGenerator;
const expected = Object.values(db.sequelize.models).map(model => expectedModel(model, generator));
const inventory = () => expected.map(model => ({ name: model.table, columns: model.columns.map(column => ({ name: column.name })) }));
test.after(() => db.sequelize.close());

test('membership schema audit scopes the actual alumni read chain, including WHERE and ORDER BY columns', () => {
 const report = membershipReadSchema(expected, inventory());
 assert.equal(report.baseReadsResolvable, true);
 assert.equal(report.allReadsResolvable, true);
 assert.deepEqual(report.dependencies.map(read => read.model), ['User', 'MembershipApplication', 'AlumniProfile', 'AlumniRecord', 'EmploymentHistory']);
 const application = report.dependencies.find(read => read.model === 'MembershipApplication');
 assert.deepEqual(application.requiredColumns, expected.find(model => model.model === 'MembershipApplication').columns.map(column => column.name));
 const history = report.dependencies.find(read => read.model === 'EmploymentHistory');
 assert.ok(history.requiredColumns.includes('alumni_id'));
 assert.ok(history.requiredColumns.includes('id'));
 assert.ok(history.condition);
});

test('membership schema audit identifies a missing prerequisite column rather than assuming membership tables are missing', () => {
 const actual = inventory();
 const users = actual.find(table => table.name === 'users');
 users.columns = users.columns.filter(column => column.name !== 'alumni_record_id');
 const report = membershipReadSchema(expected, actual);
 assert.equal(report.baseReadsResolvable, false);
 assert.deepEqual(report.dependencies[0].missingColumns, ['alumni_record_id']);
 assert.equal(report.dependencies[1].status, 'available');
});

test('membership schema audit distinguishes missing conditional tables and exact-case variants', () => {
 const actual = inventory();
 actual.find(table => table.name === 'employmenthistories').name = 'EmploymentHistories';
 const report = membershipReadSchema(expected, actual);
 assert.equal(report.baseReadsResolvable, true);
 assert.equal(report.allReadsResolvable, false);
 const history = report.dependencies.find(read => read.model === 'EmploymentHistory');
 assert.equal(history.status, 'missing_table');
 assert.equal(history.actualTable, null);
 assert.deepEqual(history.caseVariants, ['EmploymentHistories']);
});

test('membership administrator and queue schema cannot cause a false alumni readiness failure', () => {
 const actual = inventory().filter(table => !['membershipadministrators', 'email_queue_jobs'].includes(table.name));
 assert.equal(membershipReadSchema(expected, actual).allReadsResolvable, true);
});
