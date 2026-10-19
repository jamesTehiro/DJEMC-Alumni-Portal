const db = require("../models");
const { safeEmailError } = require("./emailDiagnostics");

const enqueueEmails = async (jobs = [], options = {}) => {

    const validJobs = jobs
        .filter((job) => job?.to)
        .map((job) => ({
            to: job.to,
            subject: job.subject,
            message: job.message,
            dedupe_key: job.dedupe_key || null,
            scheduled_at: job.scheduled_at || new Date(),
            attempts: 0,
            status: "pending"
        }));


    if (!validJobs.length) {
        return;
    }

    try {
        const result = await db.EmailQueueJob.bulkCreate(validJobs, { transaction: options.transaction });
        return result;

    } catch (err) {
        console.error("[email] enqueue failed:", safeEmailError(err));
        if (options.transaction) throw err;
    }
};

module.exports = {
    enqueueEmails
};
