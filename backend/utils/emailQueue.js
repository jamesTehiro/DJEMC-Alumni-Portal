const db = require("../models");

const enqueueEmails = async (jobs = []) => {
    console.log("=== [DEBUG] emailQueue.enqueueEmails ===");
    console.log("[DEBUG] Input jobs count:", jobs.length);

    const validJobs = jobs
        .filter((job) => job?.to)
        .map((job) => ({
            to: job.to,
            subject: job.subject,
            message: job.message,
            scheduled_at: job.scheduled_at || new Date(),
            attempts: 0,
            status: "pending"
        }));

    console.log("[DEBUG] Valid (filtered) jobs count:", validJobs.length);
    console.log("[DEBUG] Valid jobs to addresses:", JSON.stringify(validJobs.map(j => j.to)));
    console.log("[DEBUG] Valid jobs subjects:", JSON.stringify(validJobs.map(j => j.subject)));

    if (!validJobs.length) {
        console.log("[DEBUG] No valid jobs to enqueue. Returning.");
        return;
    }

    try {
        const result = await db.EmailQueueJob.bulkCreate(validJobs);
        console.log("[DEBUG] EmailQueueJob.bulkCreate completed. Records created:", result ? result.length : 0);

        // Verify the records were actually inserted
        const verifyCount = await db.EmailQueueJob.count({ where: { status: "pending" } });
        console.log("[DEBUG] Total pending EmailQueueJob records in DB:", verifyCount);
    } catch (err) {
        console.error("[DEBUG] EmailQueueJob.bulkCreate ERROR:", err.message);
        console.error("[DEBUG] EmailQueueJob.bulkCreate ERROR stack:", err.stack);
    }
};

module.exports = {
    enqueueEmails
};
