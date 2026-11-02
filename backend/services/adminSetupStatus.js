const { MAIL_KEYS } = require('./adminOtpConfiguration');
const { LIMIT_MESSAGE } = require('./adminRegistration');

// Public capability information only. Full field-level diagnostics stay in the
// offline readiness command; neither credentials nor account identities belong here.
function adminSetupStatus(availability, configuration, loginConfigured) {
    const issues = configuration.issues;
    const bootstrapConfigured = !issues.some(issue => issue.variable === 'ADMIN_BOOTSTRAP_SECRET');
    const otpConfigured = !issues.some(issue => [...MAIL_KEYS, 'REGISTRATION_OTP_SECRET'].includes(issue.variable));
    const registrationAvailable = !availability.setupComplete && configuration.ready;
    const registrationReason = availability.setupComplete ? 'ADMIN_LIMIT_REACHED'
        : !bootstrapConfigured ? 'ADMIN_BOOTSTRAP_UNAVAILABLE'
            : !otpConfigured ? 'ADMIN_OTP_UNAVAILABLE'
                : !configuration.ready ? 'ADMIN_REGISTRATION_UNAVAILABLE' : 'AVAILABLE';
    const messages = {
        ADMIN_LIMIT_REACHED: LIMIT_MESSAGE,
        ADMIN_BOOTSTRAP_UNAVAILABLE: 'Admin registration is unavailable because the bootstrap secret is missing or invalid.',
        ADMIN_OTP_UNAVAILABLE: 'Admin registration is unavailable because OTP email configuration is incomplete or invalid.',
        ADMIN_REGISTRATION_UNAVAILABLE: 'Admin registration configuration is unavailable.',
        AVAILABLE: 'Admin registration is available.'
    };
    return { ...availability, loginAvailable: !!loginConfigured, registrationAvailable,
        registrationConfigured: configuration.ready, bootstrapConfigured, otpConfigured,
        registrationReason, msg: messages[registrationReason] };
}
module.exports = { adminSetupStatus };
