const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { Op } = require("sequelize");
const db = require("../models");
const sendEmail = require("../utils/email");
const { safeEmailError } = require("../utils/emailDiagnostics");
let configurationPaused = false;

const pollIntervalMs = Number(process.env.EMAIL_QUEUE_POLL_MS || 2000);
const batchSize = Number(process.env.EMAIL_QUEUE_BATCH_SIZE || 20);
const maxConcurrency = Number(process.env.EMAIL_QUEUE_CONCURRENCY || 5);
const staleProcessingMs = Number(process.env.EMAIL_QUEUE_STALE_MS || 5 * 60 * 1000);
const retryDelayMs = Number(process.env.EMAIL_QUEUE_RETRY_MS || 30000);

const reserveJobs = async () =>
    db.sequelize.transaction(async (transaction) => {
        const now = new Date();
        const staleBefore = new Date(now.getTime() - staleProcessingMs);
        const jobs = await db.EmailQueueJob.findAll({
            where: {
                [Op.and]: [
                    db.sequelize.literal("attempts < max_attempts"),
                    {
                        [Op.or]: [
                            {
                                [Op.and]: [
                                    { status: { [Op.in]: ["pending", "failed"] } },
                                    { scheduled_at: { [Op.lte]: now } }
                                ]
                            },
                            {
                                [Op.and]: [
                                    { status: "processing" },
                                    { processing_started_at: { [Op.lt]: staleBefore } }
                                ]
                            }
                        ]
                    }
                ]
            },
            order: [["scheduled_at", "ASC"], ["id", "ASC"]],
            limit: batchSize,
            lock: true,
            skipLocked: true,
            transaction
        });

        if (!jobs.length) return [];

        const reservedIds = jobs.map((job) => job.id);
        await db.EmailQueueJob.update(
            {
                status: "processing",
                processing_started_at: new Date(),
                last_error: null
            },
            {
                where: {
                    id: {
                        [Op.in]: reservedIds
                    }
                },
                transaction
            }
        );

        return db.EmailQueueJob.findAll({
            where: {
                id: {
                    [Op.in]: reservedIds
                }
            },
            order: [["scheduled_at", "ASC"], ["id", "ASC"]],
            transaction
        });
    });

const markJobSent = async (job) =>
    job.update({
        status: "sent",
        sent_at: new Date(),
        processing_started_at: null,
        last_error: null
    });

const markJobFailed = async (job, error) => {
    const nextAttempts = job.attempts + 1;
    const hasRemainingAttempts = nextAttempts < job.max_attempts;

    await job.update({
        status: hasRemainingAttempts ? "pending" : "failed",
        attempts: nextAttempts,
        processing_started_at: null,
        last_error: JSON.stringify(safeEmailError(error)),
        scheduled_at: hasRemainingAttempts ? new Date(Date.now() + retryDelayMs) : job.scheduled_at
    });
};

const processJob = async (job) => {
    console.log("[email] processing", { jobId: job.id, attempts: job.attempts });
    try {
        await sendEmail(job.to, job.subject, job.message);
        await markJobSent(job);
        console.log("[email] sent (SMTP accepted)", { jobId: job.id });
    } catch (error) {
        console.error("[email] delivery failed", { jobId: job.id, ...safeEmailError(error) });
        await markJobFailed(job, error);
    }
};

const processBatch = async () => {
    try {
        sendEmail.validateConfiguration?.();
        if (configurationPaused) console.log("[email] configuration restored; queue resumed");
        configurationPaused = false;
    } catch {
        if (!configurationPaused) console.warn("[email] queue paused: invalid or missing SMTP settings; jobs and attempts unchanged");
        configurationPaused = true;
        return;
    }
    const jobs = await reserveJobs();
    if (!jobs.length) return;

    for (let index = 0; index < jobs.length; index += maxConcurrency) {
        const slice = jobs.slice(index, index + maxConcurrency);
        // eslint-disable-next-line no-await-in-loop
        await Promise.allSettled(slice.map((job) => processJob(job)));
    }
};

const main = async () => {
    sendEmail.logConfiguration();
    await db.sequelize.authenticate();

    // eslint-disable-next-line no-console
    console.log("Email queue worker started.");

    const run = async () => {
        try {
            await processBatch();
        } catch (error) {
            // eslint-disable-next-line no-console
            console.error("Email queue worker error:", safeEmailError(error));
        } finally {
            setTimeout(run, pollIntervalMs);
        }
    };

    run();
};

if (require.main === module) {
    main().catch((error) => {
        // eslint-disable-next-line no-console
        console.error("Failed to start email queue worker:", safeEmailError(error));
        process.exit(1);
    });
}

module.exports = { reserveJobs, processJob, processBatch };
