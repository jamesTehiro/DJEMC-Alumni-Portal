const test = require("node:test");
const assert = require("node:assert/strict");
const { Op } = require("sequelize");

const db = require("../models");
const { reserveJobs } = require("../workers/emailQueueWorker");
test.after(() => db.sequelize.close());

test("missing email provider configuration leaves queued jobs and attempt counts untouched", async () => {
    const email = require("../utils/email");
    const originalValidate = email.validateConfiguration;
    const originalTransaction = db.sequelize.transaction;
    let reservations = 0;
    email.validateConfiguration = () => { throw Object.assign(new Error("missing settings"), { code: "EMAIL_CONFIG" }); };
    db.sequelize.transaction = async () => { reservations += 1; throw new Error("must not reserve"); };
    try {
        await require("../workers/emailQueueWorker").processBatch();
        assert.equal(reservations, 0);
    } finally {
        email.validateConfiguration = originalValidate;
        db.sequelize.transaction = originalTransaction;
    }
});

test("email worker holds stale deliveries for review and reserves only pending jobs with a consumed attempt", async () => {
    const originalTransaction = db.sequelize.transaction;
    const originalFindAll = db.EmailQueueJob.findAll;
    const originalUpdate = db.EmailQueueJob.update;
    const findCalls = [];
    const updates = [];
    const pendingJob = { id: 919, status: "pending" };

    db.sequelize.transaction = (callback) => callback({ LOCK: { UPDATE: "UPDATE" } });
    db.EmailQueueJob.findAll = async (options) => {
        findCalls.push(options);
        return [pendingJob];
    };
    db.EmailQueueJob.update = async (...args) => { updates.push(args); return [1]; };

    try {
        const jobs = await reserveJobs();
        assert.deepEqual(jobs, [pendingJob]);
        assert.equal(findCalls.length, 2);
        assert.equal(updates.length, 3);
        assert.equal(updates[0][0].status, 'failed');
        assert.equal(updates[0][0].last_error, JSON.stringify({ code: 'EMAIL_AMBIGUOUS' }));
        assert.equal(updates[0][1].where.status, 'processing');
        assert.ok(updates[0][1].where[Op.or][0].processing_started_at[Op.lt] instanceof Date);
        assert.equal(updates[1][0].last_error, JSON.stringify({ code: 'EMAIL_EXHAUSTED' }));
        assert.deepEqual(updates[2][0], {
            status: "processing",
            processing_started_at: updates[2][0].processing_started_at,
            attempts: db.sequelize.literal('attempts + 1'),
            last_error: null
        });

        assert.equal(findCalls[0].where.status, 'pending');
        assert.equal(findCalls[0].where[Op.and][0].val, 'attempts < max_attempts');
        assert.equal(findCalls[0].lock, 'UPDATE');
        assert.equal(findCalls[0].skipLocked, true);
    } finally {
        db.sequelize.transaction = originalTransaction;
        db.EmailQueueJob.findAll = originalFindAll;
        db.EmailQueueJob.update = originalUpdate;
    }
});
