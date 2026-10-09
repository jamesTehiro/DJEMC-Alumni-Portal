const nodemailer = require("nodemailer");

let cachedTransporter = null;
let cachedKey = null;

const getTransporter = () => {
    const host = process.env.SMTP_HOST || "smtp.gmail.com";
    const port = Number(process.env.SMTP_PORT || 465);
    const secure = String(process.env.SMTP_SECURE || (port === 465)).toLowerCase() === "true";

    // Support both older `EMAIL` and newer `EMAIL_USER` env var names.
    const user = process.env.EMAIL_USER || process.env.EMAIL;
    const pass = process.env.EMAIL_PASS;

    if (!user || !pass) {
        throw new Error(
            "Email configuration error: EMAIL_USER and EMAIL_PASS environment variables must be set."
        );
    }

    const key = `${host}|${port}|${secure}|${user}`;
    if (cachedTransporter && cachedKey === key) return cachedTransporter;

    cachedKey = key;
    cachedTransporter = nodemailer.createTransport({
        host,
        port,
        secure,
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
