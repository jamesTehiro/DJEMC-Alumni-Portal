const db = require("../models");
const { safeEmailError } = require("./emailDiagnostics");

const enqueueEmails = async (jobs = [], options = {}) => {
    console.log("=== [DEBUG] emailQueue.enqueueEmails ===");
    console.log("[DEBUG] Input jobs count:", jobs.length);

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

    console.log("[DEBUG] Valid (filtered) jobs count:", validJobs.length);

    if (!validJobs.length) {
        console.log("[DEBUG] No valid jobs to enqueue. Returning.");
        return;
    }

    try {
        const result = await db.EmailQueueJob.bulkCreate(validJobs, { transaction: options.transaction });
        console.log("[DEBUG] EmailQueueJob.bulkCreate completed. Records created:", result ? result.length : 0);

    } catch (err) {
        console.error("[email] enqueue failed:", safeEmailError(err));
        if (options.transaction) throw err;
    }
};

module.exports = {
    enqueueEmails
};
