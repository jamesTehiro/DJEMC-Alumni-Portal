const crypto = require("node:crypto");
const { environment } = require("../config/adminOtpEnvironment");
const MAIL_KEYS = ["EMAIL_PROVIDER", "BREVO_API_KEY", "EMAIL_FROM", "EMAIL_FROM_NAME"];
const API_KEYS = [...MAIL_KEYS, "REGISTRATION_OTP_SECRET", "ADMIN_BOOTSTRAP_SECRET"];
const DATABASE_KEYS = ["DB_HOST", "DB_NAME", "DB_USER"];
const text = value => typeof value === "string" ? value.trim() : "";
const isPlaceholder = value => /^(?:replace|your(?:[_ -]|$)|placeholder|change[_ -]?me|insert[_ -]|put[_ -]|example[_ -]|todo(?:[_ -]|$)|<.*>)/i.test(text(value));
const normalize = (key, value) => key === "EMAIL_PROVIDER" ? text(value).toLowerCase() : text(value);
function inspectConfiguration(env, { role = "api", source = "runtime", sourceError = null, effectiveEnv } = {}) {
    const keys = [...(role === "worker" ? MAIL_KEYS : API_KEYS), ...DATABASE_KEYS];
    const issues = [];
    for (const key of keys) {
        if (!text(env[key])) issues.push({ variable: key, issue: "missing" });
        else if (isPlaceholder(env[key])) issues.push({ variable: key, issue: "placeholder" });
    }
    if (sourceError) issues.push({ variable: "environment", issue: sourceError });
    if (text(env.EMAIL_PROVIDER) && normalize("EMAIL_PROVIDER", env.EMAIL_PROVIDER) !== "brevo") issues.push({ variable: "EMAIL_PROVIDER", issue: "must_be_brevo" });
    if (text(env.BREVO_API_KEY) && /[\u0000-\u0020\u007f]/.test(text(env.BREVO_API_KEY))) issues.push({ variable: "BREVO_API_KEY", issue: "invalid_format" });
    if (/@(?:example\.(?:com|net|org|invalid)|localhost)$/i.test(text(env.EMAIL_FROM))) issues.push({ variable: "EMAIL_FROM", issue: "placeholder" });
    const mailbox = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
    if (text(env.EMAIL_FROM) && (!mailbox.test(text(env.EMAIL_FROM)) || text(env.EMAIL_FROM).length > 254 || /[\r\n\u0000]/.test(env.EMAIL_FROM))) issues.push({ variable: "EMAIL_FROM", issue: "invalid_address" });
    if (text(env.EMAIL_FROM_NAME) && /[\u0000-\u001f\u007f]/.test(env.EMAIL_FROM_NAME)) issues.push({ variable: "EMAIL_FROM_NAME", issue: "invalid_format" });
    if (role !== "worker" && text(env.REGISTRATION_OTP_SECRET) && Buffer.byteLength(env.REGISTRATION_OTP_SECRET) < 32) issues.push({ variable: "REGISTRATION_OTP_SECRET", issue: "at_least_32_random_bytes_required" });
    if (text(env.DB_PORT) && (!/^\d+$/.test(text(env.DB_PORT)) || Number(env.DB_PORT) < 1 || Number(env.DB_PORT) > 65535)) issues.push({ variable: "DB_PORT", issue: "invalid_port" });
    if (text(env.EMAIL_REQUEST_TIMEOUT_MS) && (!/^\d+$/.test(text(env.EMAIL_REQUEST_TIMEOUT_MS)) || Number(env.EMAIL_REQUEST_TIMEOUT_MS) < 1000 || Number(env.EMAIL_REQUEST_TIMEOUT_MS) > 30000)) issues.push({ variable: "EMAIL_REQUEST_TIMEOUT_MS", issue: "invalid_timeout" });
    if (effectiveEnv) {
        for (const key of [...MAIL_KEYS, ...DATABASE_KEYS, "DB_PORT", ...(role === "worker" ? [] : ["REGISTRATION_OTP_SECRET"])]) {
            const expected = key === "DB_PORT" ? String(env[key] || 3306) : key === "REGISTRATION_OTP_SECRET" ? env[key] : normalize(key, env[key]);
            const actual = key === "DB_PORT" ? String(effectiveEnv[key] || 3306) : key === "REGISTRATION_OTP_SECRET" ? effectiveEnv[key] : normalize(key, effectiveEnv[key]);
            if (expected !== actual) issues.push({ variable: key, issue: "differs_from_selected_environment" });
        }
    }
    return { ready: issues.length === 0, role, source, present: Object.fromEntries(keys.map(key => [key, !!text(env[key])])), issues };
}
function inspectAdminOtpConfiguration({ role = "api" } = {}) {
    return inspectConfiguration(environment.get(), { role, source: environment.kind, sourceError: environment.sourceError, effectiveEnv: process.env });
}
function assertAdminOtpConfiguration(options) {
    const report = inspectAdminOtpConfiguration(options);
    if (!report.ready) throw Object.assign(new Error("Admin OTP configuration is incomplete or invalid."), {
        code: "ADMIN_OTP_CONFIG", status: 503, publicMessage: "Admin OTP verification is temporarily unavailable. Contact the system administrator.", configurationIssues: report.issues
    });
    return environment.get();
}
function configurationFingerprint(env) {
    const scope = [normalize("EMAIL_PROVIDER", env.EMAIL_PROVIDER), text(env.EMAIL_FROM), text(env.EMAIL_FROM_NAME), text(env.DB_HOST).toLowerCase(), String(env.DB_PORT || 3306), text(env.DB_NAME), text(env.DB_USER)];
    return crypto.createHmac("sha256", text(env.BREVO_API_KEY)).update(JSON.stringify(scope)).digest("hex").slice(0, 24);
}
module.exports = { inspectConfiguration, inspectAdminOtpConfiguration, assertAdminOtpConfiguration, configurationFingerprint, isPlaceholder, MAIL_KEYS, API_KEYS };
