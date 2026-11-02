// Read-only aggregate/schema/configuration checks; no names, emails or secrets.
const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");
const dotenv = require("dotenv");
const { inspectConfiguration } = require("../services/adminOtpConfiguration");
const { environment } = require("../config/adminOtpEnvironment");
async function check({ env, connect = mysql.createConnection, configurationOnly = false, role = "api", source = "runtime", sourceError = null, effectiveEnv }) {
    const configuration = inspectConfiguration(env, { role, source, sourceError, effectiveEnv });
    const report = { readOnly: true, sendsEmail: false, deployedRuntimeVerified: false,
        bootstrapSecretPresent: !!env.ADMIN_BOOTSTRAP_SECRET,
        otpSecretValid: role === "worker" ? null : !configuration.issues.some(issue => issue.variable === "REGISTRATION_OTP_SECRET"),
        emailProvider: ["brevo", "smtp"].includes(String(env.EMAIL_PROVIDER || "").trim().toLowerCase()) ? String(env.EMAIL_PROVIDER).trim().toLowerCase() : "unset_or_invalid",
        brevoSettingsPresent: ["BREVO_API_KEY", "EMAIL_FROM", "EMAIL_FROM_NAME"].every(key => !!env[key]?.trim()),
        configuration, configurationReady: configuration.ready, databaseCheckAttempted: false, ready: false };
    if (!configuration.ready || configurationOnly) return { ...report, ready: configurationOnly && configuration.ready };
    report.databaseCheckAttempted = true;
    let connection;
    try {
        if (!env.DB_HOST || !env.DB_NAME || !env.DB_USER) throw Object.assign(new Error("Missing configuration"), { code: "DB_CONFIG_MISSING" });
        const local = /^(localhost|127\.0\.0\.1|::1)$/i.test(env.DB_HOST);
        connection = await connect({ host: env.DB_HOST, port: Number(env.DB_PORT || 3306), database: env.DB_NAME,
            user: env.DB_USER, password: env.DB_PASS || "", connectTimeout: 5000,
            ...(!local && { ssl: { rejectUnauthorized: true, ca: fs.readFileSync(env.DB_CA_FILE || path.join(__dirname, "../cert/ca.pem")) } }) });
        const [[version]] = await connection.query("SELECT VERSION() AS version");
        report.databaseVersion = version.version;
        const [counts] = await connection.query("SELECT admin_scope, account_status, COUNT(*) AS count FROM users WHERE role='admin' GROUP BY admin_scope, account_status");
        report.adminCounts = counts.map(row => ({ scope: ["registrar", "alumni", "employer"].includes(row.admin_scope) ? row.admin_scope : "legacy_or_unknown", status: ["verified", "pending", "rejected", "suspended", "deactivated"].includes(row.account_status) ? row.account_status : "unknown", count: Number(row.count) }));
        const [tables] = await connection.query("SELECT TABLE_NAME AS name, ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('users','registration_email_verifications','email_queue_jobs','rate_limit_entries')");
        report.tables = tables;
        const [indexes] = await connection.query("SELECT INDEX_NAME AS name, NON_UNIQUE AS non_unique, COLUMN_NAME AS col, SEQ_IN_INDEX AS position, SUB_PART AS prefix_length FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' ORDER BY INDEX_NAME, SEQ_IN_INDEX");
        const groups = new Map();
        for (const index of indexes) groups.set(index.name, [...(groups.get(index.name) || []), index]);
        const unique = columns => [...groups.values()].some(group => group.every(index => !Number(index.non_unique) && !index.prefix_length) && group.map(index => index.col).join(",") === columns);
        report.uniqueAdminScopeIndex = unique("role,admin_scope");
        report.uniqueEmailIndex = unique("email");
        report.uniqueNormalizedEmailIndex = unique("normalized_email");
        report.schemaReady = ["users", "registration_email_verifications", "email_queue_jobs", "rate_limit_entries"].every(name => tables.some(table => table.name === name && table.engine === "InnoDB")) && report.uniqueAdminScopeIndex && report.uniqueEmailIndex && report.uniqueNormalizedEmailIndex;
    } catch (error) { report.connectionError = error.code || error.name; }
    finally { if (connection) await connection.end(); }
    report.ready = configuration.ready && report.schemaReady === true && !report.connectionError;
    return report;
}
async function main() {
    const args = process.argv.slice(2);
    const options = new Map();
    for (let index = 0; index < args.length; index++) {
        const flag = args[index];
        if (!["--env-file", "--configuration-only", "--role"].includes(flag) || options.has(flag)) throw new Error("Invalid arguments");
        if (flag === "--configuration-only") options.set(flag, true);
        else { const value = args[++index]; if (!value || value.startsWith("--")) throw new Error("Missing argument"); options.set(flag, value); }
    }
    const role = options.get("--role") || "api";
    if (!["api", "worker"].includes(role)) throw new Error("Invalid role");
    // Read only the explicitly selected file; never merge the main .env.
    const env = options.has("--env-file") ? dotenv.parse(fs.readFileSync(path.resolve(options.get("--env-file")))) : environment.get();
    const report = await check({ env, role, source: options.has("--env-file") ? "explicit-file" : environment.kind, sourceError: options.has("--env-file") ? null : environment.sourceError, effectiveEnv: options.has("--env-file") ? undefined : process.env, configurationOnly: options.has("--configuration-only") });
    console.log(JSON.stringify(report, null, 2));
    if (!report.ready) process.exitCode = 1;
}
if (require.main === module) main().catch(error => { console.error("[ADMIN_PREFLIGHT_FAILED]", { kind: error.name }); process.exitCode = 1; });
module.exports = { check };
