const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../models');
const { enqueueEmails } = require('../utils/emailQueue');
test.after(() => db.sequelize.close());
test('enqueue preserves keyed deduplication, multiple NULL keys, transaction and retry defaults', async () => {
 const originalBulk = db.EmailQueueJob.bulkCreate, originalCount = db.EmailQueueJob.count;
 let rows, options; const transaction = {};
 db.EmailQueueJob.bulkCreate = async (input, opts) => { rows = input; options = opts; return input; };
 db.EmailQueueJob.count = async () => 3;
 try {
  await enqueueEmails([{ to: 'a@example.invalid', subject: 's', message: 'm', dedupe_key: 'event:1' }, { to: 'b@example.invalid', subject: 's', message: 'm' }, { to: 'c@example.invalid', subject: 's', message: 'm' }], { transaction });
  assert.equal(rows[0].dedupe_key, 'event:1'); assert.equal(rows[1].dedupe_key, null); assert.equal(rows[2].dedupe_key, null); assert.equal(options.transaction, transaction);
  assert.ok(rows.every(r => r.status === 'pending' && r.attempts === 0 && r.scheduled_at instanceof Date));
  const model = db.EmailQueueJob; assert.equal(model.rawAttributes.dedupe_key.allowNull, true); assert.equal(model.rawAttributes.dedupe_key.type.options.length, 191);
  assert.ok(model.options.indexes.some(i => i.unique && i.fields.length === 1 && i.fields[0] === 'dedupe_key'));
 } finally { db.EmailQueueJob.bulkCreate = originalBulk; db.EmailQueueJob.count = originalCount; }
});
test('a database duplicate-key rejection propagates to transactional callers instead of committing incomplete work', async () => {
 const original = db.EmailQueueJob.bulkCreate;
 const duplicate = Object.assign(new Error('duplicate'), { name: 'SequelizeUniqueConstraintError' });
 db.EmailQueueJob.bulkCreate = async () => { throw duplicate; };
 try { await assert.rejects(enqueueEmails([{ to: 'a@example.invalid', dedupe_key: 'event:1' }], { transaction: {} }), e => e === duplicate); }
 finally { db.EmailQueueJob.bulkCreate = original; }
});
test('worker retries and success retain the original dedupe key', async () => {
 const emailPath = require.resolve('../utils/email'); const prior = require.cache[emailPath];
 let fail = true;
 require.cache[emailPath] = { id: emailPath, filename: emailPath, loaded: true, exports: async () => { if (fail) throw new Error('temporary mail failure'); } };
 const workerPath = require.resolve('../workers/emailQueueWorker'); const priorWorker = require.cache[workerPath]; delete require.cache[workerPath];
 try {
  const { processJob } = require(workerPath);
  const updates = []; const job = { id: 1, to: 'a@example.invalid', dedupe_key: 'event:1', attempts: 0, max_attempts: 5, scheduled_at: new Date(), update: async values => { updates.push(values); Object.assign(job, values); } };
  await processJob(job); assert.equal(job.status, 'pending'); assert.equal(job.attempts, 1); assert.equal(job.dedupe_key, 'event:1');
  fail = false; await processJob(job); assert.equal(job.status, 'sent'); assert.equal(job.dedupe_key, 'event:1'); assert.ok(updates.every(v => !Object.hasOwn(v, 'dedupe_key')));
 } finally { if (prior) require.cache[emailPath] = prior; else delete require.cache[emailPath]; if (priorWorker) require.cache[workerPath] = priorWorker; else delete require.cache[workerPath]; }
});
