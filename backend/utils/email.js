const nodemailer = require("nodemailer");

let cachedTransporter = null;
let cachedKey = null;

const getConfiguration = () => {
    const host = process.env.SMTP_HOST || "smtp.gmail.com";
    const port = Number(process.env.SMTP_PORT || 465);
    const secure = String(process.env.SMTP_SECURE || (port === 465)).toLowerCase() === "true";

    // Support both older `EMAIL` and newer `EMAIL_USER` env var names.
    const user = process.env.EMAIL_USER || process.env.EMAIL;
    const pass = process.env.EMAIL_PASS;

    if (!user || !pass) {
        throw Object.assign(new Error(
            "Email configuration error: EMAIL_USER and EMAIL_PASS environment variables must be set."
        ), { code: "EMAIL_CONFIG" });
    }

    if (!Number.isInteger(port) || port < 1 || port > 65535 ||
        (process.env.SMTP_SECURE && !/^(true|false)$/i.test(process.env.SMTP_SECURE)) ||
        (port === 587 && secure)) {
        throw Object.assign(new Error("Email configuration error: invalid SMTP port/security settings; port 587 requires SMTP_SECURE=false."), { code: "EMAIL_CONFIG" });
    }
    return { host, port, secure, user, pass };
};

const getTransporter = () => {
    const { host, port, secure, user, pass } = getConfiguration();

    const key = JSON.stringify([host, port, secure, user, pass]);
    if (cachedTransporter && cachedKey === key) return cachedTransporter;

    cachedKey = key;
    cachedTransporter = nodemailer.createTransport({
        host,
        port,
        secure,
        requireTLS: port === 587,
        connectionTimeout: 15000,
        greetingTimeout: 15000,
        socketTimeout: 30000,
        auth: { user, pass }
    });

    return cachedTransporter;
};

const sendEmail = async (to, subject, text) => {
    const transporter = getTransporter();
    const from = process.env.EMAIL_FROM || process.env.EMAIL_USER || process.env.EMAIL;
    await transporter.sendMail({ from, to, subject, text });
};

module.exports = sendEmail;
module.exports.validateConfiguration = getConfiguration;
module.exports.verify = () => getTransporter().verify();
module.exports.logConfiguration = () => {
    let configured = true;
    try { getConfiguration(); } catch { configured = false; }
    console.log("[email] configuration", {
        configured,
        SMTP_HOST: Boolean(process.env.SMTP_HOST),
        SMTP_PORT: Boolean(process.env.SMTP_PORT),
        SMTP_SECURE: Boolean(process.env.SMTP_SECURE),
        EMAIL_USER: Boolean(process.env.EMAIL_USER || process.env.EMAIL),
        EMAIL_PASS: Boolean(process.env.EMAIL_PASS),
        EMAIL_FROM: Boolean(process.env.EMAIL_FROM),
        port: Number(process.env.SMTP_PORT || 465),
        secure: String(process.env.SMTP_SECURE || (Number(process.env.SMTP_PORT || 465) === 465)).toLowerCase() === "true"
    });
};
