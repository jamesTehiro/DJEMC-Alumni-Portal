const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { Op } = require("sequelize");
const db = require("../models");
const sendEmail = require("../utils/email");
const { safeEmailError, safeMessageId } = require("../utils/emailDiagnostics");
let configurationPaused = false;

const setting = (name, fallback) => {
    const value = Number(process.env[name] || fallback);
    if (!Number.isSafeInteger(value) || value < 1 || value > 2147483647) {
        throw Object.assign(new Error(`Invalid positive integer setting: ${name}`), { code: "EMAIL_CONFIG" });
    }
    return value;
};
const pollIntervalMs = setting("EMAIL_QUEUE_POLL_MS", 2000);
const batchSize = setting("EMAIL_QUEUE_BATCH_SIZE", 20);
const maxConcurrency = setting("EMAIL_QUEUE_CONCURRENCY", 5);
const staleProcessingMs = setting("EMAIL_QUEUE_STALE_MS", 5 * 60 * 1000);
const retryDelayMs = setting("EMAIL_QUEUE_RETRY_MS", 30000);
if (staleProcessingMs < Math.ceil(batchSize / maxConcurrency) * 30000 + 10000) {
    throw Object.assign(new Error("EMAIL_QUEUE_STALE_MS must cover the whole reserved batch and transport timeout."), { code: "EMAIL_CONFIG" });
}

const reserveJobs = async () => db.sequelize.transaction(async transaction => {
    const now = new Date();
    // A crashed worker may already have delivered. Retain the row for explicit
    // review instead of automatically sending an ambiguous delivery again.
    const [held] = await db.EmailQueueJob.update({
        status: "failed", processing_started_at: null,
        last_error: JSON.stringify({ code: "EMAIL_AMBIGUOUS" })
    }, { where: { status: "processing", [Op.or]: [
        { processing_started_at: { [Op.lt]: new Date(now.getTime() - staleProcessingMs) } },
        { processing_started_at: null }
    ] }, transaction });
    if (held) console.warn("[email] stale deliveries held for review", { count: held, code: "EMAIL_AMBIGUOUS" });
    await db.EmailQueueJob.update({ status: "failed", last_error: JSON.stringify({ code: "EMAIL_EXHAUSTED" }) }, {
        where: { status: "pending", [Op.and]: [db.sequelize.literal("attempts >= max_attempts")] }, transaction
    });
    const jobs = await db.EmailQueueJob.findAll({
        where: { status: "pending", scheduled_at: { [Op.lte]: now }, [Op.and]: [db.sequelize.literal("attempts < max_attempts")] },
        order: [["scheduled_at", "ASC"], ["id", "ASC"]], limit: batchSize,
        lock: transaction.LOCK.UPDATE, skipLocked: true, transaction
    });
    if (!jobs.length) return [];
    const ids = jobs.map(job => job.id);
    await db.EmailQueueJob.update({ status: "processing", processing_started_at: now,
        attempts: db.sequelize.literal("attempts + 1"), last_error: null
    }, { where: { id: { [Op.in]: ids } }, transaction });
    return db.EmailQueueJob.findAll({ where: { id: { [Op.in]: ids } }, order: [["scheduled_at", "ASC"], ["id", "ASC"]], transaction });
});

const lease = job => ({ id: job.id, status: "processing", attempts: job.attempts, processing_started_at: job.processing_started_at });
const writeState = async (job, values) => {
    const [changed] = await db.EmailQueueJob.update(values, { where: lease(job) });
    if (!changed) console.warn("[email] delivery lease no longer owned", { jobId: job.id });
    return changed;
};
const markJobSent = job => writeState(job, { status: "sent", sent_at: new Date(), processing_started_at: null, last_error: null });
const markJobFailed = (job, error) => {
    const retry = error?.retryable === true && job.attempts < job.max_attempts;
    const requestedDelay = Number.isFinite(error?.retryAfterMs) ? Math.max(0, error.retryAfterMs) : 0;
    return writeState(job, {
        status: retry ? "pending" : "failed", processing_started_at: null,
        last_error: JSON.stringify(safeEmailError(error)),
        scheduled_at: retry ? new Date(Date.now() + Math.max(retryDelayMs, requestedDelay)) : job.scheduled_at
    });
};
const processJob = async job => {
    if (!await db.EmailQueueJob.findOne({ where: lease(job), attributes: ["id"] })) return;
    console.log("[email] processing", { jobId: job.id, attempts: job.attempts });
    let receipt;
    try { receipt = await sendEmail(job.to, job.subject, job.message); }
    catch (error) {
        console.error("[email] delivery failed", { jobId: job.id, ...safeEmailError(error) });
        await markJobFailed(job, error);
        return;
    }
    // A failed status write must never turn provider acceptance into a retry.
    try {
        const recorded = await markJobSent(job);
        console.log("[email] provider accepted", { jobId: job.id, recorded: Boolean(recorded), messageId: safeMessageId(receipt?.messageId) });
    } catch {
        console.error("[email] accepted delivery state could not be recorded; held for review", { jobId: job.id, code: "EMAIL_STATE", messageId: safeMessageId(receipt?.messageId) });
    }
};
const processBatch = async () => {
    try {
        sendEmail.validateConfiguration?.();
        if (configurationPaused) console.log("[email] configuration restored; queue resumed");
        configurationPaused = false;
    } catch {
        if (!configurationPaused) console.warn("[email] queue paused: invalid or missing email provider settings; jobs and attempts unchanged");
        configurationPaused = true;
        return;
    }
    const jobs = await reserveJobs();
    for (let index = 0; index < jobs.length; index += maxConcurrency) {
        const results = await Promise.allSettled(jobs.slice(index, index + maxConcurrency).map(processJob));
        for (const result of results) if (result.status === "rejected") console.error("[email] queue state operation failed", safeEmailError(result.reason));
    }
};
const main = async () => {
    sendEmail.logConfiguration();
    await db.sequelize.authenticate();
    console.log("Email queue worker started.");
    let stopping = false, wake;
    const stop = () => { stopping = true; wake?.(); };
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
    process.once("disconnect", stop);
    while (!stopping) {
        try { await processBatch(); }
        catch (error) { console.error("Email queue worker error:", safeEmailError(error)); }
        if (!stopping) await new Promise(resolve => {
            const timer = setTimeout(resolve, pollIntervalMs);
            wake = () => { clearTimeout(timer); resolve(); };
        });
    }
    await db.sequelize.close();
};
if (require.main === module) main().catch(error => {
    console.error("Failed to start email queue worker:", safeEmailError(error));
    process.exit(1);
});
module.exports = { reserveJobs, processJob, processBatch };
