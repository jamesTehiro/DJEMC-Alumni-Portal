const { inspectConfiguration, configurationFingerprint } = require('./adminOtpConfiguration');
const { createRegistrationOtpQueue, queuedOtpJobKey, isCurrentQueuedOtp } = require('./registrationOtpQueue');
const PREFIX = 'employer-registration-otp:';
function configuration(role = 'worker') {
    // Worker role validates the shared mail/DB settings without Admin secrets.
    const issues = inspectConfiguration(process.env, { role }).issues.filter(issue => issue.variable !== 'ADMIN_BOOTSTRAP_SECRET');
    if (issues.length) throw Object.assign(new Error('Employer OTP configuration unavailable'), {
        code: 'EMPLOYER_OTP_CONFIG', status: 503,
        publicMessage: 'Employer Gmail verification is temporarily unavailable. Please try again later.'
    });
    return process.env;
}
const jobKey = (row, role) => queuedOtpJobKey(row, configurationFingerprint(configuration(role)), PREFIX);
const createEmployerOtpQueue = ({ db, enqueueEmails }) => createRegistrationOtpQueue({ db, enqueueEmails, keyForChallenge: row => jobKey(row, 'api') });
async function isActiveEmployerOtpJob(db, job, now = Date.now()) {
    if (!String(job.dedupe_key || '').startsWith(PREFIX)) return true;
    return isCurrentQueuedOtp(db, job, now, jobKey);
}
module.exports = { createEmployerOtpQueue, isActiveEmployerOtpJob, PREFIX, jobKey };
