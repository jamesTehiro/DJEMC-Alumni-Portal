const { safeMessageId } = require("./emailDiagnostics");

const BREVO_EMAIL_URL = "https://api.brevo.com/v3/smtp/email";
const REQUEST_TIMEOUT_MS = 15000;
let cachedTransporter = null;
let cachedKey = null;

const emailError = (message, code, responseCode, retryable = false) => Object.assign(new Error(message), {
    code,
    retryable,
    ...(Number.isInteger(responseCode) ? { responseCode } : {})
});
const isTimeout = error => ["TimeoutError", "AbortError"].includes(error?.name) ||
    ["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"].includes(error?.code || error?.cause?.code);

const getProvider = () => {
    // Adding a secret must not silently switch the active transport. Unset
    // retains legacy SMTP; Brevo requires the explicit deployment setting.
    const configured = String(process.env.EMAIL_PROVIDER || "smtp").trim().toLowerCase();
    if (!["brevo", "smtp"].includes(configured)) {
        throw emailError("Email configuration error: EMAIL_PROVIDER must be brevo or smtp.", "EMAIL_CONFIG");
    }
    return configured;
};

const requestTimeoutMs = () => {
    const timeout = Number(process.env.EMAIL_REQUEST_TIMEOUT_MS || REQUEST_TIMEOUT_MS);
    // The worker's reservation budget already allows 30s per transport call.
    if (!Number.isSafeInteger(timeout) || timeout < 1000 || timeout > 30000) {
        throw emailError("Email configuration error: EMAIL_REQUEST_TIMEOUT_MS must be an integer from 1000 to 30000.", "EMAIL_CONFIG");
    }
    return timeout;
};

const address = (value, code) => {
    if (typeof value !== "string") throw emailError("Email address is invalid.", code);
    const email = value.trim();
    const parts = email.split("@");
    const atom = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/i;
    const domain = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
    if (email.length > 254 || parts.length !== 2 || parts[0].length > 64 ||
        !atom.test(parts[0]) || !domain.test(parts[1]) || /[\r\n\u0000]/.test(value)) {
        throw emailError("Email address is invalid; use one mailbox per recipient.", code);
    }
    return email;
};

const recipients = to => {
    const values = Array.isArray(to) ? to : [to];
    if (!values.length) throw emailError("Email recipients are invalid.", "EMAIL_RECIPIENT");
    return values.map(value => {
        const email = address(typeof value === "string" ? value : value?.email, "EMAIL_RECIPIENT");
        const name = typeof value === "object" && value ? value.name : undefined;
        if (name !== undefined && (typeof name !== "string" || /[\u0000-\u001f\u007f]/.test(name))) {
            throw emailError("Email recipient name is invalid.", "EMAIL_RECIPIENT");
        }
        return { email, ...(name ? { name } : {}) };
    });
};

const validateMessage = (subject, text, options) => {
    if (typeof subject !== "string" || !subject.trim() || /[\r\n\u0000]/.test(subject) ||
        !options || typeof options !== "object" || Array.isArray(options) ||
        (text !== undefined && typeof text !== "string") ||
        (options.html !== undefined && typeof options.html !== "string") || !(text || options.html)) {
        throw emailError("Email subject or content is invalid.", "EMAIL_MESSAGE");
    }
};

const getBrevoConfiguration = () => {
    const apiKey = process.env.BREVO_API_KEY?.trim();
    const from = process.env.EMAIL_FROM?.trim();
    const fromName = process.env.EMAIL_FROM_NAME?.trim();
    if (!apiKey || !from || !fromName) {
        throw emailError("Email configuration error: BREVO_API_KEY, EMAIL_FROM, and EMAIL_FROM_NAME must be set for Brevo.", "EMAIL_CONFIG");
    }
    address(process.env.EMAIL_FROM, "EMAIL_CONFIG");
    if (/[\u0000-\u001f\u007f]/.test(process.env.EMAIL_FROM_NAME) || /[\u0000-\u0020\u007f]/.test(apiKey)) {
        throw emailError("Email configuration error: invalid Brevo sender or API key format.", "EMAIL_CONFIG");
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
    requestTimeoutMs();
    const provider = getProvider();
    return provider === "brevo"
        ? { provider, ...getBrevoConfiguration() }
        : { provider, ...getSmtpConfiguration() };
};

const getTransporter = () => {
    const { host, port, secure, user, pass } = getSmtpConfiguration();
    const timeout = requestTimeoutMs();
    const key = JSON.stringify([host, port, secure, user, pass, timeout]);
    if (cachedTransporter && cachedKey === key) return cachedTransporter;

    cachedKey = key;
    cachedTransporter = require("nodemailer").createTransport({
        host,
        port,
        secure,
        requireTLS: port === 587,
        connectionTimeout: timeout,
        greetingTimeout: timeout,
        socketTimeout: 30000,
        auth: { user, pass }
    });

    return cachedTransporter;
};

const retryAfterMs = response => {
    const value = response.headers?.get?.("retry-after");
    if (!value) return undefined;
    const delay = /^\d+(?:\.\d+)?$/.test(value) ? Number(value) * 1000 : Date.parse(value) - Date.now();
    return Number.isFinite(delay) && delay >= 0 ? Math.min(delay, 2147483647) : undefined;
};

const sendWithBrevo = async (to, subject, text, options) => {
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
                to,
                subject,
                ...(text ? { textContent: text } : {}),
                ...(options.html ? { htmlContent: options.html } : {})
            }),
            signal: AbortSignal.timeout(requestTimeoutMs()),
            // Custom api-key headers must never be forwarded to a redirect.
            redirect: "error"
        });
    } catch (error) {
        const timedOut = isTimeout(error);
        throw Object.assign(emailError(
            timedOut ? "Brevo email request timed out." : "Brevo email request failed due to a network error.",
            timedOut ? "ETIMEDOUT" : "EMAIL_NETWORK",
            undefined,
            false
        ), { deliveryUnknown: true });
    }

    if (!response.ok) {
        // 429 explicitly rejects the request. A timeout or 5xx can follow
        // acceptance, so hold those for review rather than blindly resending.
        const error = emailError("Brevo rejected the email request.", "EMAIL_API", response.status, response.status === 429);
        if (response.status === 408 || response.status >= 500) error.deliveryUnknown = true;
        if (error.retryable) error.retryAfterMs = retryAfterMs(response);
        // Do not read/log private error bodies; release the HTTP connection.
        try { await response.body?.cancel?.(); } catch { /* Already closed/aborted. */ }
        throw error;
    }

    let result;
    try {
        result = await response.json();
    } catch (error) {
        throw Object.assign(emailError("Brevo returned an incomplete email response.", isTimeout(error) ? "ETIMEDOUT" : "EMAIL_RESPONSE", response.status, false), { deliveryUnknown: true });
    }
    if (!result || !safeMessageId(result.messageId)) {
        throw Object.assign(emailError("Brevo returned an invalid email response.", "EMAIL_RESPONSE", response.status, false), { deliveryUnknown: true });
    }
    return result;
};

const sendEmail = async (to, subject, text, options = {}) => {
    const { provider } = getConfiguration();
    const validatedRecipients = recipients(to);
    validateMessage(subject, text, options);
    if (provider === "brevo") return sendWithBrevo(validatedRecipients, subject, text, options);
    const transporter = getTransporter();
    const from = process.env.EMAIL_FROM || process.env.EMAIL_USER || process.env.EMAIL;
    try { return await transporter.sendMail({ from, to: validatedRecipients.map(({ email, name }) => ({ address: email, ...(name ? { name } : {}) })), subject, text, ...(options.html ? { html: options.html } : {}) }); }
    catch (error) {
        const allowed = ["EAUTH", "ECONNECTION", "ETIMEDOUT", "ESOCKET", "EDNS", "ECONNREFUSED", "ECONNRESET", "EENVELOPE", "EMESSAGE", "ETLS"];
        const retryable = (error.responseCode >= 400 && error.responseCode < 500) || ["EDNS", "ECONNREFUSED", "ECONNECTION"].includes(error.code);
        throw emailError("SMTP email request failed.", allowed.includes(error.code) ? error.code : "EMAIL_NETWORK", error.responseCode, retryable);
    }
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
        requestTimeoutMs: (() => { try { return requestTimeoutMs(); } catch { return null; } })(),
        port: Number(process.env.SMTP_PORT || 465),
        secure: String(process.env.SMTP_SECURE || (Number(process.env.SMTP_PORT || 465) === 465)).toLowerCase() === "true"
    });
};
