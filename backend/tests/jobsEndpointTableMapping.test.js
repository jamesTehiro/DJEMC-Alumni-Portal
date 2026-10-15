const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../models');
const controller = require('../controllers/jobController');
const routes = require('../routes/jobRoutes');
test.after(() => db.sequelize.close());
test('GET /api/jobs uses the loaded lowercase jobs model in actual generated SELECT SQL', async () => {
 const route = routes.stack.find(layer => layer.route?.path === '/' && layer.route.methods.get).route;
 assert.equal(route.stack.at(-1).handle, controller.getJobs);
 assert.equal(db.Job, db.sequelize.models.Job);
 assert.equal(db.Job.getTableName(), 'jobs');
 const qi = db.sequelize.getQueryInterface();
 const originalDescribe = qi.describeTable, originalQuery = db.sequelize.query;
 const described = [], queries = [];
 qi.describeTable = async table => {
  described.push(table);
  const model = Object.values(db.sequelize.models).find(model => model.getTableName() === table);
  assert.ok(model, table);
  return Object.fromEntries(Object.keys(model.rawAttributes).map(key => [key, {}]));
 };
 db.sequelize.query = async sql => { queries.push(sql); return []; };
 const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
 try {
  await route.stack.at(-1).handle({ query: {}, originalUrl: '/api/jobs' }, response);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, []);
  assert.equal(described[0], 'jobs');
  assert.equal(queries.length, 1);
  assert.match(queries[0], /FROM `jobs` AS `Job`/);
  assert.doesNotMatch(queries[0], /FROM `Jobs`/);
  assert.match(queries[0], /recruitment_status/);
 } finally { qi.describeTable = originalDescribe; db.sequelize.query = originalQuery; }
});
