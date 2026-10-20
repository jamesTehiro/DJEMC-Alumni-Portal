const db = require("../models");
const sendEmail = require("../utils/registrationOtpEmail");
const { consumeRateLimit } = require("../utils/rateLimitStore");
const { createRegistrationOtp, digest } = require("../services/registrationOtp");
const { emailKey } = require("../utils/registrationEmail");
const otp = createRegistrationOtp({ db, sendEmail });

exports.otp = otp;
exports.rateLimit = (operation, dimensions = ["ip", "email", "session"]) => async (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    try {
        // req.ip honors Express's configured trust boundary. Never take the
        // first caller-supplied X-Forwarded-For value as the client identity.
        const ip = digest(String(req.ip || req.socket?.remoteAddress || "unknown"));
        const settings = {
            send: { ip: 20, email: 10, session: 10 },
            verify: { ip: 60, email: 30, session: 30 },
            status: { ip: 180, session: 120 },
            submit: { ip: 30, email: 10, session: 10 }
        }[operation];
        const identities = { ip, email: digest(emailKey(req.body?.email)), session: digest(String(req.body?.session_token || "missing").slice(0, 256)) };
        const limits = dimensions.filter(dimension => settings[dimension] && (dimension === "ip" || req.body?.[dimension === "email" ? "email" : "session_token"]))
            .map(dimension => ({ scope: `registration-${operation}-${dimension}`, key: identities[dimension], maxRequests: settings[dimension], windowMs: 60 * 60 * 1000 }));
        for (const limit of limits) {
            const result = await consumeRateLimit(limit);
            if (!result.allowed) {
                const retryAfter = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
                res.setHeader("Retry-After", String(retryAfter));
                return res.status(429).json({ code: "OTP_RATE_LIMIT", msg: "Too many registration requests. Please try again later.", retry_after: retryAfter });
            }
        }
        return next();
    } catch {
        // Security checks fail closed even when the global limiter uses proxy mode.
        return res.status(503).json({ msg: "Registration verification is temporarily unavailable." });
    }
};
const handle = method => async (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    try {
        return res.json(method === "resend"
            ? await otp.send(req.body?.email, req.body?.session_token, { resend: true })
            : await otp[method](req.body?.email, req.body?.session_token, req.body?.otp));
    } catch (error) {
        const safeCategories = new Set([
            "otp_secret_missing_or_short", "resend_history_invalid", "database_error",
            "brevo_unauthorized", "brevo_forbidden", "brevo_rate_limited", "brevo_server_error",
            "brevo_rejected", "brevo_timeout", "email_configuration", "brevo_network_error",
            "email_provider_error"
        ]);
        const category = safeCategories.has(error?.failureCategory)
            ? error.failureCategory
            : error?.publicMessage ? "otp_request_rejected" : "internal_error";
        const providerStatus = Number.isInteger(error?.providerStatus) && error.providerStatus >= 400 && error.providerStatus <= 599
            ? error.providerStatus : undefined;
        console.warn("[registration-otp] request failure", {
            operation: method,
            category,
            ...(providerStatus ? { providerStatus } : {})
        });
        if (error.publicMessage) {
            if (error.retryAfter) res.setHeader("Retry-After", String(error.retryAfter));
            return res.status(error.status).json({ code: error.code, msg: error.publicMessage, ...(error.retryAfter ? { retry_after: error.retryAfter } : {}) });
        }
        error.status = 503;
        error.publicMessage = "Registration verification is temporarily unavailable. Please try again later.";
        return next(error);
    }
};
exports.send = handle("send");
exports.resend = handle("resend");
exports.verify = handle("verify");
exports.status = handle("status");
