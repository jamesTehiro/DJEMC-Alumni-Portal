const { digest } = require("./registrationOtp");
const { emailKey } = require("../utils/registrationEmail");
const { configurationFingerprint, assertAdminOtpConfiguration } = require("./adminOtpConfiguration");
const PREFIX = "admin-registration-otp:";
// Fits the existing unique dedupe_key VARCHAR(191); no new schema is needed.
const jobKey = (row, fingerprint) => `${PREFIX}${digest(row.email_key)}:${row.otp_hash}:${new Date(row.expires_at).getTime().toString(36)}${fingerprint ? ":" + fingerprint : ""}`;
function createAdminOtpQueue({ db, enqueueEmails, validateConfiguration = () => {} }) {
    return {
        async sendEmail(to, subject, message, _options, challenge) {
            const configuration = validateConfiguration();
            const fingerprint = configuration ? configurationFingerprint(configuration) : undefined;
            await db.sequelize.transaction(async transaction => {
                await enqueueEmails([{ to, subject, message, dedupe_key: jobKey(challenge, fingerprint) }], { transaction });
            });
        },
        async deliveryStatus(row, transaction) {
            if (!row.otp_hash) return "failed";
            const configuration = validateConfiguration();
            const fingerprint = configuration ? configurationFingerprint(configuration) : undefined;
            const job = await db.EmailQueueJob.findOne({ where: { dedupe_key: jobKey(row, fingerprint) }, attributes: ["status"], transaction });
            return job?.status || "failed";
        }
    };
}
async function isActiveAdminOtpJob(db, job, now = Date.now(), { requireConfiguration = false } = {}) {
    if (!String(job.dedupe_key || "").startsWith(PREFIX)) return true;
    const match = String(job.dedupe_key).match(/^admin-registration-otp:[a-f0-9]{64}:[a-f0-9]{64}:[a-z0-9]+:([a-f0-9]{24})$/);
    const fingerprint = match?.[1];
    if (requireConfiguration) {
        const configuration = assertAdminOtpConfiguration({ role: "worker" });
        if (!fingerprint || configurationFingerprint(configuration) !== fingerprint) return false;
    }
    const row = await db.RegistrationEmailVerification.findByPk(emailKey(job.to));
    return !!row && ["sending", "sent"].includes(row.status) && !!row.otp_hash && jobKey(row, fingerprint) === job.dedupe_key
        && row.email === job.to && now < new Date(row.expires_at).getTime();
}
module.exports = { createAdminOtpQueue, isActiveAdminOtpJob, jobKey, PREFIX };
