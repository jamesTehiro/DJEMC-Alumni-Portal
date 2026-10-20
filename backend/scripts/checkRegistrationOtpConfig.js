require("dotenv").config({ path: require("path").join(__dirname, "..", ".env"), quiet: true });
const email = require("../utils/email");
let brevoConfigured = false;
try { brevoConfigured = email.validateConfiguration().provider === "brevo"; } catch { /* Report booleans only. */ }
const keys = ["DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASS", "JWT_SECRET", "BREVO_API_KEY", "EMAIL_FROM", "EMAIL_FROM_NAME", "REGISTRATION_OTP_SECRET", "MIGRATION_DB_HOST", "MIGRATION_DB_PORT", "MIGRATION_DB_NAME", "MIGRATION_DB_USER", "MIGRATION_DB_PASS", "MIGRATION_DB_CA_FILE"];
const report = { environment: process.env.NODE_ENV || "development", present: Object.fromEntries(keys.map(key => [key, !!process.env[key]])),
    brevoConfigured, otpSecretAtLeast32Bytes: Buffer.byteLength(process.env.REGISTRATION_OTP_SECRET || "") >= 32,
    databaseSyncDisabled: process.env.ENABLE_DB_SYNC !== "true",
    proxyHopCountConfigured: /^[1-9]\d*$/.test(process.env.TRUST_PROXY_HOPS || "") };
console.log(JSON.stringify(report, null, 2));
if (!report.brevoConfigured || !report.otpSecretAtLeast32Bytes || !report.databaseSyncDisabled) process.exitCode = 1;
