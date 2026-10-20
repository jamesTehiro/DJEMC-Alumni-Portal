const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { normalizeEmail, emailKey, isGmail, EMAIL_KEY_SQL } = require("../utils/registrationEmail");

const OTP_TTL = 5 * 60 * 1000;
const GRANT_TTL = 10 * 60 * 1000;
const COOLDOWN = 60 * 1000;
const SEND_WINDOW = 15 * 60 * 1000;
const MAX_RESENDS = 3;
const fail = (status, code, message, extra = {}) => Object.assign(new Error(message), { status, code, publicMessage: message, ...extra });
const markFailure = (error, category) => {
    if (error && typeof error === "object" && !error.failureCategory) error.failureCategory = category;
    return error;
};
const emailFailureCategory = error => {
    if (error?.code === "EMAIL_API") {
        if (error.responseCode === 401) return "brevo_unauthorized";
        if (error.responseCode === 403) return "brevo_forbidden";
        if (error.responseCode === 429) return "brevo_rate_limited";
        if (Number.isInteger(error.responseCode) && error.responseCode >= 500) return "brevo_server_error";
        return "brevo_rejected";
    }
    if (["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"].includes(error?.code) || error?.name === "TimeoutError") return "brevo_timeout";
    if (error?.code === "EMAIL_CONFIG") return "email_configuration";
    if (error?.code === "EMAIL_NETWORK") return "brevo_network_error";
    return "email_provider_error";
};
const digest = value => crypto.createHash("sha256").update(value).digest("hex");
const validSession = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

function createRegistrationOtp({ db, sendEmail, now = Date.now, randomInt = crypto.randomInt }) {
    const secret = () => {
        const value = process.env.REGISTRATION_OTP_SECRET;
        if (!value || Buffer.byteLength(value) < 32) throw fail(503, "OTP_UNAVAILABLE", "Gmail verification is temporarily unavailable.", { failureCategory: "otp_secret_missing_or_short" });
        return value;
    };
    const hashOtp = (email, sessionHash, otp) => crypto.createHmac("sha256", secret()).update(`${email}\n${sessionHash}\n${otp}`).digest("hex");
    const validate = (email, session) => {
        if (!isGmail(email)) throw fail(400, "INVALID_GMAIL", "Enter a valid @gmail.com address.");
        if (!validSession(session)) throw fail(400, "INVALID_SESSION", "Start Gmail verification again in this browser.");
    };
    const findAccount = async email => {
        try {
            return await db.User.findOne({
                where: db.Sequelize.where(db.Sequelize.literal(`(${EMAIL_KEY_SQL})`), emailKey(email)),
                attributes: ["id", "account_status", "role"]
            });
        } catch (error) { throw markFailure(error, "database_error"); }
    };
    const ensureAvailable = async email => {
        const existing = await findAccount(email);
        if (existing) throw fail(409, "EMAIL_REGISTERED", existing.account_status === "rejected"
            ? "This Gmail address has an existing registration. Contact the Registrar Officer for review or resubmission; your records are preserved."
            : "Gmail is already registered, including accounts pending Registrar approval.");
    };
    const matches = (row, email, session) => row && row.email === email && row.session_hash === digest(session);
    const history = row => {
        let entries;
        try { entries = typeof row.resend_history === "string" ? JSON.parse(row.resend_history) : row.resend_history; }
        catch { throw fail(503, "OTP_UNAVAILABLE", "Gmail verification is temporarily unavailable.", { failureCategory: "resend_history_invalid" }); }
        if (!Array.isArray(entries) || entries.some(time => !Number.isSafeInteger(time))) throw fail(503, "OTP_UNAVAILABLE", "Gmail verification is temporarily unavailable.", { failureCategory: "resend_history_invalid" });
        return entries.filter(time => time > now() - SEND_WINDOW);
    };
    const grant = row => jwt.sign({
        purpose: "alumni-registration", email: row.email, session_hash: row.session_hash,
        verified_at: new Date(row.verified_at).getTime(),
        iat: Math.floor(new Date(row.verified_at).getTime() / 1000),
        exp: Math.floor((new Date(row.verified_at).getTime() + GRANT_TTL) / 1000)
    }, secret(), { algorithm: "HS256", audience: "alumni-registration", issuer: "alumni-portal" });
    const view = row => {
        const resends = history(row);
        const verified = row.status === "verified" && now() < new Date(row.verified_at).getTime() + GRANT_TTL;
        return {
            email: row.email, status: row.status, verified,
            expires_at: row.expires_at, server_time: new Date(now()),
            verification_expires_at: row.verified_at ? new Date(new Date(row.verified_at).getTime() + GRANT_TTL) : null,
            resend_at: new Date(new Date(row.sent_at).getTime() + COOLDOWN),
            attempts_remaining: Math.max(0, 5 - row.failed_attempts),
            resends_remaining: Math.max(0, MAX_RESENDS - resends.length),
            send_window_resets_at: resends.length ? new Date(resends[0] + SEND_WINDOW) : null,
            ...(verified ? { registration_authorization: grant(row) } : {})
        };
    };
    const lock = async (email, session, transaction) => {
        const row = await db.RegistrationEmailVerification.findByPk(emailKey(email), { transaction, lock: transaction.LOCK.UPDATE });
        if (!matches(row, email, session)) throw fail(403, "INVALID_SESSION", "Verification belongs to another email or session. Request a new code.");
        return row;
    };
    const service = {
        findAccount,
        async send(emailValue, session, { resend = false } = {}) {
            const email = normalizeEmail(emailValue);
            validate(email, session);
            secret();
            await ensureAvailable(email);
            const sessionHash = digest(session);
            const otp = String(randomInt(0, 1000000)).padStart(6, "0");
            const otpHash = hashOtp(email, sessionHash, otp);
            // Atomic reservation serializes first requests across Render instances.
            // A conflicting insert never overwrites another session or a user.
            let reservation;
            try { reservation = await db.sequelize.transaction(async transaction => {
                const time = now();
                await db.sequelize.query(`INSERT INTO registration_email_verifications
                    (email_key, email, session_hash, status, sent_at, resend_history, failed_attempts, createdAt, updatedAt)
                    VALUES (?, ?, ?, 'failed', '1970-01-01 00:00:00', '[]', 0, UTC_TIMESTAMP(), UTC_TIMESTAMP())
                    ON DUPLICATE KEY UPDATE email_key = email_key`, {
                    replacements: [emailKey(email), email, sessionHash], transaction
                });
                const row = await db.RegistrationEmailVerification.findByPk(emailKey(email), { transaction, lock: transaction.LOCK.UPDATE });
                if (!row) throw fail(400, "INVALID_SESSION", "Start a new registration session for this Gmail address.");
                if (row.consumed_at) throw fail(409, "EMAIL_REGISTERED", "Gmail is already registered.");
                // Retried initial requests reuse a challenge. Resend is explicit.
                if (!resend && matches(row, email, session) && (
                    row.status === "sending" && time < new Date(row.sent_at).getTime() + COOLDOWN ||
                    row.status === "sent" && time < new Date(row.expires_at).getTime() ||
                    row.status === "verified" && time < new Date(row.verified_at).getTime() + GRANT_TTL
                )) return { reused: view(row) };
                const retryMs = new Date(row.sent_at).getTime() + COOLDOWN - time;
                if (retryMs > 0) throw fail(429, "OTP_COOLDOWN", "Wait 60 seconds between code requests.", { retryAfter: Math.ceil(retryMs / 1000) });
                const resends = history(row);
                if (resends.length >= MAX_RESENDS) throw fail(429, "OTP_SEND_LIMIT", "Three resends per 15 minutes are allowed. Please wait before requesting another code.", { retryAfter: Math.ceil((resends[0] + SEND_WINDOW - time) / 1000) });
                if (row.expires_at != null) resends.push(time);
                await row.update({ email, session_hash: sessionHash, otp_hash: otpHash, status: "sending", expires_at: new Date(time + OTP_TTL),
                    verified_at: null, failed_attempts: 0, sent_at: new Date(time), resend_history: resends }, { transaction });
                return {};
            }); } catch (error) {
                if (!error?.publicMessage) markFailure(error, "database_error");
                throw error;
            }
            if (reservation.reused) return reservation.reused;
            const where = { email_key: emailKey(email), session_hash: sessionHash, otp_hash: otpHash, status: "sending" };
            try {
                // Reuse the verified sender and existing Brevo transport. Plaintext
                // OTPs never enter the durable queue, which can delay delivery.
                const text = ["Hello,", "", "Thank you for registering with the DJEMC Alumni Tracking and Job Portal System.", "",
                    "Your email verification code is:", "", otp, "", "This code is valid for 5 minutes.", "",
                    "Please enter the code on the registration page to verify your Gmail address.", "",
                    "If you did not request this verification, you may safely ignore this email.", "",
                    "Don Jose Ecleo Memorial College", "Alumni Tracking and Job Portal System"].join("\n");
                const html = `<div style="background:#f6f2e9;padding:24px;font-family:Arial,sans-serif;color:#173f2a"><div style="max-width:540px;margin:auto;background:#fff;border-radius:12px;padding:28px"><h2 style="color:#1f6b49">Verify your Gmail address</h2><p>Hello,</p><p>Thank you for registering with the DJEMC Alumni Tracking and Job Portal System.</p><p>Your email verification code is:</p><p style="font-size:32px;font-weight:bold;letter-spacing:8px;background:#f6f2e9;padding:16px;text-align:center">${otp}</p><p>This code is valid for <strong>5 minutes</strong>.</p><p>Please enter the code on the registration page to verify your Gmail address.</p><p>If you did not request this verification, you may safely ignore this email.</p><hr><p>Don Jose Ecleo Memorial College<br>Alumni Tracking and Job Portal System</p></div></div>`;
                await sendEmail(email, "DJEMC Alumni Registration — Email Verification Code", text, { html });
            } catch (error) {
                const wait = Math.max(COOLDOWN, Math.min(SEND_WINDOW, Number(error.retryAfterMs) || 0));
                try {
                    await db.RegistrationEmailVerification.update({ otp_hash: null, status: "failed", sent_at: new Date(now() + wait - COOLDOWN) }, { where });
                } catch (databaseError) { throw markFailure(databaseError, "database_error"); }
                throw fail(503, "OTP_DELIVERY_FAILED", "Unable to send the verification email. Please wait before resending. Your registration has not been submitted.", {
                    retryAfter: Math.ceil(wait / 1000), failureCategory: emailFailureCategory(error),
                    ...(Number.isInteger(error?.responseCode) && error.responseCode >= 400 && error.responseCode <= 599 ? { providerStatus: error.responseCode } : {})
                });
            }
            let updated;
            try { [updated] = await db.RegistrationEmailVerification.update({ status: "sent" }, { where }); }
            catch (error) { throw markFailure(error, "database_error"); }
            if (!updated) throw fail(409, "OTP_REPLACED", "A newer code request replaced this one. Use the most recent code.");
            return service.status(email, session);
        },
        async status(emailValue, session) {
            const email = normalizeEmail(emailValue);
            validate(email, session);
            const row = await db.RegistrationEmailVerification.findByPk(emailKey(email));
            if (!matches(row, email, session)) throw fail(403, "INVALID_SESSION", "Start Gmail verification again for this address.");
            return view(row);
        },
        async verify(emailValue, session, otp) {
            const email = normalizeEmail(emailValue);
            validate(email, session);
            // Failed attempts must commit before their error response is returned.
            const result = await db.sequelize.transaction(async transaction => {
                const row = await lock(email, session, transaction);
                if (row.consumed_at) return { error: fail(400, "OTP_CONSUMED", "Verification has already been used.") };
                if (row.status === "verified" && now() < new Date(row.verified_at).getTime() + GRANT_TTL) return { value: view(row) };
                if (row.failed_attempts >= 5) return { error: fail(429, "OTP_ATTEMPTS", "Too many incorrect attempts. Request a new code.") };
                if (row.status !== "sent" || !row.otp_hash) return { error: fail(400, "OTP_NOT_READY", "Request a new code, or wait for the current email request to finish.") };
                if (now() >= new Date(row.expires_at).getTime()) return { error: fail(400, "OTP_EXPIRED", "Your code has expired. Request a new code.") };
                const wellFormed = typeof otp === "string" && /^\d{6}$/.test(otp);
                const supplied = hashOtp(email, row.session_hash, wellFormed ? otp : "invalid");
                if (!wellFormed || !crypto.timingSafeEqual(Buffer.from(row.otp_hash, "hex"), Buffer.from(supplied, "hex"))) {
                    await row.update({ failed_attempts: row.failed_attempts + 1 }, { transaction });
                    return { error: fail(row.failed_attempts >= 5 ? 429 : 400, row.failed_attempts >= 5 ? "OTP_ATTEMPTS" : "OTP_INCORRECT", `Incorrect code. ${Math.max(0, 5 - row.failed_attempts)} attempts remaining.`) };
                }
                // DATETIME has second precision on existing MySQL/MariaDB schemas.
                await row.update({ status: "verified", verified_at: new Date(Math.floor(now() / 1000) * 1000), otp_hash: null }, { transaction });
                return { value: view(row) };
            });
            if (result.error) throw result.error;
            return result.value;
        },
        async consume(emailValue, session, authorization, transaction) {
            const email = normalizeEmail(emailValue);
            validate(email, session);
            let claims;
            try {
                claims = jwt.verify(authorization, secret(), { algorithms: ["HS256"], audience: "alumni-registration", issuer: "alumni-portal", clockTimestamp: Math.floor(now() / 1000) });
            } catch { throw fail(403, "GMAIL_VERIFICATION_REQUIRED", "Verify your Gmail address before submitting registration. Verification lasts 10 minutes."); }
            if (claims.purpose !== "alumni-registration" || claims.email !== email || claims.session_hash !== digest(session))
                throw fail(403, "GMAIL_VERIFICATION_REQUIRED", "Verification does not match this Gmail address and registration session.");
            const row = await lock(email, session, transaction);
            if (row.status !== "verified" || !row.verified_at || row.consumed_at || claims.verified_at !== new Date(row.verified_at).getTime() || now() >= new Date(row.verified_at).getTime() + GRANT_TTL)
                throw fail(403, "GMAIL_VERIFICATION_REQUIRED", "Verify your Gmail address before submitting registration. Verification lasts 10 minutes.");
            await row.update({ status: "consumed", consumed_at: new Date(now()), otp_hash: null }, { transaction });
            return row;
        }
    };
    return service;
}

module.exports = { createRegistrationOtp, OTP_TTL, GRANT_TTL, COOLDOWN, SEND_WINDOW, MAX_RESENDS, digest, fail, validSession };
