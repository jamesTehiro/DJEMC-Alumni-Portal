const test = require("node:test");
const assert = require("node:assert/strict");
const { Op } = require("sequelize");

const db = require("../models");
const { reserveJobs } = require("../workers/emailQueueWorker");

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

test("email worker reserves stale processing jobs for recovery", async () => {
    const originalTransaction = db.sequelize.transaction;
    const originalFindAll = db.EmailQueueJob.findAll;
    const originalUpdate = db.EmailQueueJob.update;
    const findCalls = [];
    const updates = [];
    const staleJob = { id: 919, status: "processing" };

    db.sequelize.transaction = (callback) => callback({ LOCK: { UPDATE: "UPDATE" } });
    db.EmailQueueJob.findAll = async (options) => {
        findCalls.push(options);
        return findCalls.length === 1 ? [staleJob] : [staleJob];
    };
    db.EmailQueueJob.update = async (...args) => updates.push(args);

    try {
        const jobs = await reserveJobs();
        assert.deepEqual(jobs, [staleJob]);
        assert.equal(findCalls.length, 2);
        assert.equal(updates.length, 1);
        assert.deepEqual(updates[0][0], {
            status: "processing",
            processing_started_at: updates[0][0].processing_started_at,
            last_error: null
        });

        const conditions = findCalls[0].where[Op.and];
        const branches = conditions[1][Op.or];
        const staleProcessingBranch = branches[1][Op.and];
        assert.deepEqual(staleProcessingBranch[0], { status: "processing" });
        assert.ok(staleProcessingBranch[1].processing_started_at[Op.lt] instanceof Date);
    } finally {
        db.sequelize.transaction = originalTransaction;
        db.EmailQueueJob.findAll = originalFindAll;
        db.EmailQueueJob.update = originalUpdate;
    }
});
