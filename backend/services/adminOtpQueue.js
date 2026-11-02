const { createRegistrationOtpQueue, queuedOtpJobKey, isCurrentQueuedOtp } = require("./registrationOtpQueue");
const { configurationFingerprint, assertAdminOtpConfiguration } = require("./adminOtpConfiguration");
const PREFIX = "admin-registration-otp:";
// Fits the existing unique dedupe_key VARCHAR(191); no new schema is needed.
const jobKey = (row, fingerprint) => queuedOtpJobKey(row, fingerprint, PREFIX);
function createAdminOtpQueue({ db, enqueueEmails, validateConfiguration = () => {} }) {
    return createRegistrationOtpQueue({ db, enqueueEmails, keyForChallenge: row => {
        const configuration = validateConfiguration();
        return jobKey(row, configuration ? configurationFingerprint(configuration) : undefined);
    } });
}
async function isActiveAdminOtpJob(db, job, now = Date.now(), { requireConfiguration = false } = {}) {
    if (!String(job.dedupe_key || "").startsWith(PREFIX)) return true;
    const match = String(job.dedupe_key).match(/^admin-registration-otp:[a-f0-9]{64}:[a-f0-9]{64}:[a-z0-9]+:([a-f0-9]{24})$/);
    const fingerprint = match?.[1];
    if (requireConfiguration) {
        const configuration = assertAdminOtpConfiguration({ role: "worker" });
        if (!fingerprint || configurationFingerprint(configuration) !== fingerprint) return false;
    }
    return isCurrentQueuedOtp(db, job, now, row => jobKey(row, fingerprint));
}
module.exports = { createAdminOtpQueue, isActiveAdminOtpJob, jobKey, PREFIX };
