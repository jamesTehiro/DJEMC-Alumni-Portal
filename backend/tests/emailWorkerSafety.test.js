const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const db = require('../models');
test.after(() => db.sequelize.close());

async function fixture(run) {
    const emailPath = require.resolve('../utils/email'), workerPath = require.resolve('../workers/emailQueueWorker');
    const priorEmail = require.cache[emailPath], priorWorker = require.cache[workerPath];
    const originals = { findOne: db.EmailQueueJob.findOne, update: db.EmailQueueJob.update };
    let failure, sends = 0;
    const sender = async () => { sends++; if (failure) throw failure; };
    require.cache[emailPath] = { id: emailPath, filename: emailPath, loaded: true, exports: sender };
    delete require.cache[workerPath];
    const job = { id: 31, status: 'processing', to: 'private@example.invalid', subject: 'Private', message: 'Private token',
        attempts: 1, max_attempts: 5, processing_started_at: new Date(), scheduled_at: new Date() };
    const updates = [];
    db.EmailQueueJob.findOne = async () => job;
    db.EmailQueueJob.update = async (values, options) => { updates.push({ values, options }); return [1]; };
    try { await run({ worker: require(workerPath), job, updates, sends: () => sends, fail: error => { failure = error; } }); }
    finally {
        Object.assign(db.EmailQueueJob, originals);
        if (priorEmail) require.cache[emailPath] = priorEmail; else delete require.cache[emailPath];
        if (priorWorker) require.cache[workerPath] = priorWorker; else delete require.cache[workerPath];
    }
}

test('state updates fence status, attempt and lease; rate limits respect provider delay and max attempts', async () => {
    await fixture(async ({ worker, job, updates, fail }) => {
        fail(Object.assign(new Error('private'), { code: 'EMAIL_API', responseCode: 429, retryable: true, retryAfterMs: 120000 }));
        const now = Date.now(); await worker.processJob(job);
        assert.equal(updates[0].values.status, 'pending');
        assert.ok(updates[0].values.scheduled_at.getTime() >= now + 120000);
        assert.deepEqual(updates[0].options.where, { id: job.id, status: 'processing', attempts: 1, processing_started_at: job.processing_started_at });
        assert.equal(updates[0].values.attempts, undefined, 'Attempts were consumed in the reservation, not on failure.');
        job.attempts = 5; await worker.processJob(job);
        assert.equal(updates[1].values.status, 'failed');
    });
});

test('permanent failures are terminal and provider-accepted messages are never requeued when state persistence fails', async () => {
    await fixture(async ({ worker, job, updates, fail, sends }) => {
        fail(Object.assign(new Error('private provider body'), { code: 'EMAIL_API', responseCode: 401, retryable: false }));
        await worker.processJob(job);
        assert.equal(updates[0].values.status, 'failed');
        assert.doesNotMatch(updates[0].values.last_error, /private/);
        fail(null); updates.length = 0;
        db.EmailQueueJob.update = async values => { updates.push({ values }); throw new Error('private SQL'); };
        await worker.processJob(job);
        assert.equal(sends(), 2);
        assert.equal(updates.length, 1);
        assert.equal(updates[0].values.status, 'sent');
    });
});

test('a worker that no longer owns a lease does not send or mutate a message', async () => {
    await fixture(async ({ worker, job, sends, updates }) => {
        db.EmailQueueJob.findOne = async () => null;
        await worker.processJob(job);
        assert.equal(sends(), 0); assert.equal(updates.length, 0);
    });
});

test('invalid worker limits fail before any database connection or email send', () => {
    for (const [name, value] of [['EMAIL_QUEUE_CONCURRENCY', '0'], ['EMAIL_QUEUE_POLL_MS', '-1'], ['EMAIL_QUEUE_BATCH_SIZE', 'not-a-number'], ['EMAIL_QUEUE_STALE_MS', '1']]) {
        const result = spawnSync(process.execPath, ['-e', "try { require('./workers/emailQueueWorker'); process.exit(2); } catch(e) { process.exit(e.code === 'EMAIL_CONFIG' ? 0 : 3); }"], {
            cwd: require('node:path').join(__dirname, '..'), env: { ...process.env, [name]: value }, encoding: 'utf8'
        });
        assert.equal(result.status, 0, name);
    }
});
