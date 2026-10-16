const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../models');
const announcementRoutes = require('../routes/announcementRoutes');
const membershipRoutes = require('../routes/membershipRoutes');
const announcements = require('../controllers/announcementController');
const membership = require('../controllers/membershipController');
const res = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; }, setHeader() {} });
test.after(() => db.sequelize.close());
test('public announcement route uses lowercase announcement/user/comment tables without querying the email queue', async () => {
 const route = announcementRoutes.stack.find(layer => layer.route?.path === '/' && layer.route.methods.get).route;
 assert.equal(route.stack.at(-1).handle, announcements.getAnnouncements);
 const original = db.sequelize.query; const queries = [];
 db.sequelize.query = async sql => { queries.push(sql); return []; };
 try {
  const response = res(); await route.stack.at(-1).handle({}, response);
  assert.equal(response.statusCode, 200); assert.deepEqual(response.body, []); assert.equal(queries.length, 1);
  assert.match(queries[0], /FROM `announcements` AS `Announcement`/);
  assert.match(queries[0], /JOIN `users`/); assert.match(queries[0], /JOIN `comments`/);
  assert.doesNotMatch(queries[0], /`Announcements`|email_queue_jobs/);
 } finally { db.sequelize.query = original; }
});
test('membership authentication returns 401 before entering the controller without credentials', () => {
 const auth = membershipRoutes.stack.find(layer => !layer.route).handle;
 const response = res(); let next = false;
 auth({ headers: {} }, response, () => { next = true; });
 assert.equal(response.statusCode, 401); assert.equal(response.body.msg, 'No token provided'); assert.equal(next, false);
 const route = membershipRoutes.stack.find(layer => layer.route?.path === '/me' && layer.route.methods.get).route;
 assert.equal(route.stack.at(-1).handle, membership.getMyApplication);
});
test('membership prefill reads lowercase employment histories independently of the email queue', async () => {
 const originalProfile = db.AlumniProfile.findOne, originalQuery = db.sequelize.query;
 const queries = [];
 db.AlumniProfile.findOne = async () => ({ id: 123 });
 db.sequelize.query = async sql => { queries.push(sql); return []; };
 try {
  const prefill = await membership.getMembershipPrefill({ id: 44, role: 'alumni', name: 'Test Graduate' });
  assert.deepEqual(prefill.work_experience, []); assert.equal(queries.length, 1);
  assert.match(queries[0], /FROM `employmenthistories` AS `EmploymentHistory`/);
  assert.doesNotMatch(queries[0], /`EmploymentHistories`|email_queue_jobs/);
 } finally { db.AlumniProfile.findOne = originalProfile; db.sequelize.query = originalQuery; }
});
