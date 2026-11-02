const { digest } = require('./registrationOtp');
const { emailKey } = require('../utils/registrationEmail');

const queuedOtpJobKey = (row, fingerprint, prefix) => `${prefix}${digest(row.email_key)}:${row.otp_hash}:${new Date(row.expires_at).getTime().toString(36)}${fingerprint ? ':' + fingerprint : ''}`;

// The existing Admin queue adapter supplies its own configuration-bound key;
// Employer uses the same transport without requiring Admin bootstrap settings.
function createRegistrationOtpQueue({ db, enqueueEmails, keyForChallenge }) {
    return {
        async sendEmail(to, subject, message, _options, challenge) {
            const key = keyForChallenge(challenge);
            await db.sequelize.transaction(async transaction => {
                await enqueueEmails([{ to, subject, message, dedupe_key: key }], { transaction });
            });
        },
        async deliveryStatus(row, transaction) {
            if (!row.otp_hash) return 'failed';
            const job = await db.EmailQueueJob.findOne({ where: { dedupe_key: keyForChallenge(row) }, attributes: ['status'], transaction });
            return job?.status || 'failed';
        }
    };
}
async function isCurrentQueuedOtp(db, job, now, keyForChallenge) {
    const row = await db.RegistrationEmailVerification.findByPk(emailKey(job.to));
    return !!row && ['sending', 'sent'].includes(row.status) && !!row.otp_hash && keyForChallenge(row) === job.dedupe_key
        && row.email === job.to && now < new Date(row.expires_at).getTime();
}
module.exports = { createRegistrationOtpQueue, queuedOtpJobKey, isCurrentQueuedOtp };
