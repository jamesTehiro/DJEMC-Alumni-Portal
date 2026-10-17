const nodemailer = require("nodemailer");

const BREVO_EMAIL_URL = "https://api.brevo.com/v3/smtp/email";
const REQUEST_TIMEOUT_MS = 15000;
let cachedTransporter = null;
let cachedKey = null;

const emailError = (message, code, responseCode, retryable = true) => Object.assign(new Error(message), {
    code,
    retryable,
    ...(Number.isInteger(responseCode) ? { responseCode } : {})
});

const getProvider = () => {
    const configured = String(process.env.EMAIL_PROVIDER || (process.env.BREVO_API_KEY ? "brevo" : "smtp")).trim().toLowerCase();
    if (!["brevo", "smtp"].includes(configured)) {
        throw emailError("Email configuration error: EMAIL_PROVIDER must be brevo or smtp.", "EMAIL_CONFIG");
    }
    return configured;
};

const getBrevoConfiguration = () => {
    const apiKey = process.env.BREVO_API_KEY?.trim();
    const from = process.env.EMAIL_FROM?.trim();
    const fromName = process.env.EMAIL_FROM_NAME?.trim();
    if (!apiKey || !from || !fromName) {
        throw emailError("Email configuration error: BREVO_API_KEY, EMAIL_FROM, and EMAIL_FROM_NAME must be set for Brevo.", "EMAIL_CONFIG");
    }
    return { apiKey, from, fromName };
};

const getSmtpConfiguration = () => {
    const host = process.env.SMTP_HOST || "smtp.gmail.com";
    const port = Number(process.env.SMTP_PORT || 465);
    const secure = String(process.env.SMTP_SECURE || (port === 465)).toLowerCase() === "true";

    // Support both older `EMAIL` and newer `EMAIL_USER` env var names.
    const user = process.env.EMAIL_USER || process.env.EMAIL;
    const pass = process.env.EMAIL_PASS;

    if (!user || !pass) {
        throw emailError("Email configuration error: EMAIL_USER and EMAIL_PASS environment variables must be set for SMTP.", "EMAIL_CONFIG");
    }

    if (!Number.isInteger(port) || port < 1 || port > 65535 ||
        (process.env.SMTP_SECURE && !/^(true|false)$/i.test(process.env.SMTP_SECURE)) ||
        (port === 587 && secure)) {
        throw emailError("Email configuration error: invalid SMTP port/security settings; port 587 requires SMTP_SECURE=false.", "EMAIL_CONFIG");
    }
    return { host, port, secure, user, pass };
};

const getConfiguration = () => {
    const provider = getProvider();
    return provider === "brevo"
        ? { provider, ...getBrevoConfiguration() }
        : { provider, ...getSmtpConfiguration() };
};

const getTransporter = () => {
    const { host, port, secure, user, pass } = getSmtpConfiguration();
    const key = JSON.stringify([host, port, secure, user, pass]);
    if (cachedTransporter && cachedKey === key) return cachedTransporter;

    cachedKey = key;
    cachedTransporter = nodemailer.createTransport({
        host,
        port,
        secure,
        requireTLS: port === 587,
        connectionTimeout: REQUEST_TIMEOUT_MS,
        greetingTimeout: REQUEST_TIMEOUT_MS,
        socketTimeout: 30000,
        auth: { user, pass }
    });

    return cachedTransporter;
};

const sendWithBrevo = async (to, subject, text) => {
    const { apiKey, from, fromName } = getBrevoConfiguration();
    let response;
    try {
        response = await fetch(BREVO_EMAIL_URL, {
            method: "POST",
            headers: {
                "api-key": apiKey,
                "Content-Type": "application/json",
                Accept: "application/json"
            },
            body: JSON.stringify({
                sender: { email: from, name: fromName },
                to: (Array.isArray(to) ? to : [to]).map(recipient => typeof recipient === "string" ? { email: recipient } : recipient),
                subject,
                textContent: text
            }),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        });
    } catch (error) {
        const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError" || error?.code === "ETIMEDOUT";
        throw emailError(
            timedOut ? "Brevo email request timed out." : "Brevo email request failed due to a network error.",
            timedOut ? "ETIMEDOUT" : "EMAIL_NETWORK",
            undefined,
            false
        );
    }

    if (!response.ok) {
        throw emailError("Brevo rejected the email request.", "EMAIL_API", response.status, false);
    }

    let result;
    try {
        result = await response.json();
    } catch {
        throw emailError("Brevo returned an invalid email response.", "EMAIL_RESPONSE", response.status, false);
    }
    if (!result || typeof result.messageId !== "string" || !result.messageId.trim()) {
        throw emailError("Brevo returned an invalid email response.", "EMAIL_RESPONSE", response.status, false);
    }
    return result;
};

const sendEmail = async (to, subject, text) => {
    if (getProvider() === "brevo") return sendWithBrevo(to, subject, text);
    const transporter = getTransporter();
    const from = process.env.EMAIL_FROM || process.env.EMAIL_USER || process.env.EMAIL;
    await transporter.sendMail({ from, to, subject, text });
};

module.exports = sendEmail;
module.exports.validateConfiguration = getConfiguration;
module.exports.verify = () => {
    const configuration = getConfiguration();
    return configuration.provider === "brevo" ? Promise.resolve(true) : getTransporter().verify();
};
module.exports.logConfiguration = () => {
    let provider = "unknown";
    let configured = true;
    try { provider = getProvider(); getConfiguration(); } catch { configured = false; }
    console.log("[email] configuration", {
        provider,
        configured,
        BREVO_API_KEY: Boolean(process.env.BREVO_API_KEY),
        EMAIL_FROM: Boolean(process.env.EMAIL_FROM),
        EMAIL_FROM_NAME: Boolean(process.env.EMAIL_FROM_NAME),
        SMTP_HOST: Boolean(process.env.SMTP_HOST),
        SMTP_PORT: Boolean(process.env.SMTP_PORT),
        SMTP_SECURE: Boolean(process.env.SMTP_SECURE),
        EMAIL_USER: Boolean(process.env.EMAIL_USER || process.env.EMAIL),
        EMAIL_PASS: Boolean(process.env.EMAIL_PASS),
        port: Number(process.env.SMTP_PORT || 465),
        secure: String(process.env.SMTP_SECURE || (Number(process.env.SMTP_PORT || 465) === 465)).toLowerCase() === "true"
    });
};
