const { assertAdminOtpConfiguration, inspectAdminOtpConfiguration } = require("../services/adminOtpConfiguration");
const db = require("../models");
const email = require("../utils/email");
const { enqueueEmails } = require("../utils/emailQueue");
const { createRegistrationOtp, fail } = require("../services/registrationOtp");
const { createAdminOtpQueue } = require("../services/adminOtpQueue");
const { createAdminRegistration } = require("../services/adminRegistration");
const { adminSetupStatus } = require("../services/adminSetupStatus");
const transport = createAdminOtpQueue({ db, enqueueEmails, validateConfiguration: () => {
    const configuration = assertAdminOtpConfiguration();
    if (email.validateConfiguration().provider !== "brevo") throw Object.assign(new Error("Email configuration unavailable"), { code: "EMAIL_CONFIG" });
    return configuration;
} });
const otp = createRegistrationOtp({ db, purpose: "admin-registration", ...transport });
const registration = createAdminRegistration({ db, otp });
const handle = operation => async (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    try {
        if (operation === "availability") return res.json(adminSetupStatus(
            await registration.status(), inspectAdminOtpConfiguration(), !!process.env.JWT_SECRET?.trim()
        ));
        assertAdminOtpConfiguration();
        if (operation === "create") {
            const user = await registration.create(req.body);
            return res.status(201).json({ msg: `${user.admin_scope} admin account created. Please sign in.`, user: {
                id: user.id, name: user.name, email: user.email, role: user.role, admin_scope: user.admin_scope
            } });
        }
        if (operation === "send" || operation === "resend") registration.validate(req.body);
        await registration.check(req.body?.admin_scope);
        const result = operation === "resend" ? await otp.send(req.body?.email, req.body?.session_token, { resend: true })
            : await otp[operation](req.body?.email, req.body?.session_token, req.body?.otp);
        return res.json(result);
    } catch (error) {
        if (operation === "availability") return res.status(503).json({
            code: "ADMIN_STATUS_UNAVAILABLE", registrationAvailable: false, loginAvailable: null,
            msg: "Admin registration availability could not be checked. Please try again later."
        });
        // No request payloads, email addresses, provider responses or OTPs in logs.
        if (error.publicMessage) {
            if (error.retryAfter) res.setHeader("Retry-After", String(error.retryAfter));
            return res.status(error.status).json({ code: error.code, msg: error.publicMessage, ...(error.retryAfter ? { retry_after: error.retryAfter } : {}) });
        }
        const unavailable = fail(503, "ADMIN_UNAVAILABLE", "Admin registration is temporarily unavailable. Please try again later.");
        return next(unavailable);
    }
};
exports.status = handle("availability");
exports.create = handle("create");
exports.send = handle("send");
exports.resend = handle("resend");
exports.verify = handle("verify");
exports.otpStatus = handle("status");
