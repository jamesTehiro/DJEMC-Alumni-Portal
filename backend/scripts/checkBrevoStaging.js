"use strict";

// Read-only staging preflight. It never imports the application/database,
// initializes a mail transport, sends email, or runs migrations.
const { safeEmailError, safeMessageId } = require("../utils/emailDiagnostics");
const { isGmail, normalizeEmail } = require("../utils/registrationEmail");

const EMAIL = /^[^\s@,<>]+@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const text = value => typeof value === "string" ? value.trim() : "";

function inspectEnvironment(env = process.env, options = {}) {
    const provider = text(env.EMAIL_PROVIDER).toLowerCase();
    const sender = text(env.EMAIL_FROM);
    const senderName = text(env.EMAIL_FROM_NAME);
    const apiKey = text(env.BREVO_API_KEY);
    const host = text(env.DB_HOST).toLowerCase();
    const database = text(env.DB_NAME).toLowerCase();
    const dbUser = text(env.DB_USER);
    const dbPort = Number(text(env.DB_PORT) || 3306);
    const dbPortValid = Number.isInteger(dbPort) && dbPort >= 1 && dbPort <= 65535;
    const dbConfigured = Boolean(host && database && dbUser);
    const productionDatabaseDetected = text(env.NODE_ENV).toLowerCase() === "production" ||
        /aivencloud\.com|aiven\.io|\bprod(?:uction)?\b/i.test(host) ||
        /aivencloud\.com|aiven\.io|\bprod(?:uction)?\b/i.test(text(env.DATABASE_URL)) ||
        /^(?:defaultdb|production|prod|djemc_alumni_prod(?:uction)?)$/i.test(database);
    const remoteDatabase = Boolean(host && !LOCAL_HOSTS.has(host));
    const remoteExplicitlyIsolated = text(env.STAGING_DB_ISOLATED).toLowerCase() === "true";
    const stagingDatabaseSafe = dbConfigured && dbPortValid && !productionDatabaseDetected &&
        (!remoteDatabase || remoteExplicitlyIsolated) && text(env.NODE_ENV).toLowerCase() !== "production";
    const present = {
        BREVO_API_KEY: Boolean(apiKey),
        EMAIL_FROM: Boolean(sender),
        EMAIL_FROM_NAME: Boolean(senderName),
        REGISTRATION_OTP_SECRET: Boolean(text(env.REGISTRATION_OTP_SECRET)),
        BREVO_TEST_GMAIL: Boolean(text(env.BREVO_TEST_GMAIL)),
        DB_HOST: Boolean(host), DB_PORT: Boolean(text(env.DB_PORT)), DB_NAME: Boolean(database), DB_USER: Boolean(dbUser),
        DB_PASS: Boolean(text(env.DB_PASS))
    };
    const senderConfigurationValid = Boolean(EMAIL.test(sender) && senderName && !/[\u0000-\u001f\u007f]/.test(senderName));
    const otpSecretAtLeast32Bytes = Buffer.byteLength(text(env.REGISTRATION_OTP_SECRET)) >= 32;
    const authorizedRecipientAddressValid = isGmail(env.BREVO_TEST_GMAIL);
    const brevoConfigured = provider === "brevo" && present.BREVO_API_KEY &&
        !/^(?:replace|your|placeholder|change_me)/i.test(apiKey) && !/[\u0000-\u0020\u007f]/.test(apiKey) && senderConfigurationValid;
    return {
        provider: ["smtp", "brevo"].includes(provider) ? provider : provider ? "invalid" : "missing",
        providerBrevo: provider === "brevo",
        present,
        senderConfigurationValid,
        brevoConfigured,
        otpSecretAtLeast32Bytes,
        authorizedRecipientAddressValid,
        stagingDatabaseConfigured: dbConfigured,
        stagingDatabasePortValid: dbPortValid,
        productionDatabaseDetected,
        remoteDatabaseRequiresIsolationConfirmation: remoteDatabase && !remoteExplicitlyIsolated,
        stagingDatabaseSafe,
        stagingConfigurationReady: brevoConfigured && otpSecretAtLeast32Bytes && authorizedRecipientAddressValid && stagingDatabaseSafe,
        envFileLoaded: options.envFileLoaded === true,
        sendsEmail: false, connectsDatabase: false, initializesSmtp: false, runsMigrations: false
    };
}

function parseArgs(args) {
    const values = new Map();
    const flags = new Set(["--sender", "--events", "--message-id", "--env-file"]);
    for (let index = 0; index < args.length; index++) {
        const flag = args[index];
        if (!flags.has(flag)) throw Object.assign(new Error("Unsupported diagnostic option."), { code: "EMAIL_CONFIG" });
        if (["--message-id", "--env-file"].includes(flag)) {
            const value = args[index + 1];
            if (!value || value.startsWith("--")) throw Object.assign(new Error("Missing diagnostic option value."), { code: "EMAIL_CONFIG" });
            values.set(flag, value); index++;
        } else values.set(flag, true);
    }
    if (values.has("--message-id") && !values.has("--events")) throw Object.assign(new Error("Message IDs are only accepted with --events."), { code: "EMAIL_CONFIG" });
    return values;
}

async function check(args = [], dependencies = {}) {
    const env = dependencies.env || process.env;
    const options = parseArgs(args);
    const configuration = inspectEnvironment(env, { envFileLoaded: dependencies.envFileLoaded });
    const result = { configuration, apiReadAttempted: false, productionApprovalReady: false,
        stagingIsolationSafe: configuration.stagingDatabaseSafe };
    if (!configuration.stagingConfigurationReady) return { ...result, ready: false };

    const validate = dependencies.validateConfiguration;
    if (validate) {
        const validated = validate(env);
        if (validated.provider !== "brevo") return { ...result, ready: false };
    }
    const messageId = options.get("--message-id");
    if (options.has("--events") && (!safeMessageId(messageId) || !configuration.authorizedRecipientAddressValid)) {
        throw Object.assign(new Error("Events require a valid message ID and test Gmail."), { code: "EMAIL_CONFIG" });
    }

    if (!options.has("--sender") && !options.has("--events")) return { ...result, ready: true };
    const fetchImpl = dependencies.fetch || global.fetch;
    const read = async url => {
        result.apiReadAttempted = true;
        let response;
        try {
            response = await fetchImpl(url, { method: "GET", redirect: "error",
                headers: { "api-key": text(env.BREVO_API_KEY), Accept: "application/json" },
                signal: AbortSignal.timeout(Number(env.EMAIL_REQUEST_TIMEOUT_MS || 15000)) });
        } catch { throw Object.assign(new Error("Brevo read failed."), { code: "EMAIL_NETWORK" }); }
        if (!response.ok) {
            try { await response.body?.cancel?.(); } catch { /* Do not expose provider response bodies. */ }
            throw Object.assign(new Error("Brevo read was rejected."), { code: "EMAIL_API", responseCode: response.status });
        }
        try { return await response.json(); }
        catch { throw Object.assign(new Error("Invalid Brevo response."), { code: "EMAIL_RESPONSE" }); }
    };
    if (options.has("--sender")) {
        const data = await read("https://api.brevo.com/v3/senders");
        if (!Array.isArray(data?.senders)) throw Object.assign(new Error("Invalid sender response."), { code: "EMAIL_RESPONSE" });
        const matches = data.senders.filter(sender => normalizeEmail(sender?.email) === normalizeEmail(env.EMAIL_FROM));
        result.sender = { configuredSenderListed: matches.length === 1,
            configuredSenderActive: matches.length === 1 && matches[0].active === true,
            dashboardVerificationStillRequired: true };
    }
    if (options.has("--events")) {
        const url = new URL("https://api.brevo.com/v3/smtp/statistics/events");
        url.search = new URLSearchParams({ email: normalizeEmail(env.BREVO_TEST_GMAIL), messageId, days: "1", limit: "100" }).toString();
        const data = await read(url);
        if (!Array.isArray(data?.events)) throw Object.assign(new Error("Invalid events response."), { code: "EMAIL_RESPONSE" });
        const matches = data.events.filter(event => normalizeEmail(event?.email) === normalizeEmail(env.BREVO_TEST_GMAIL) && event.messageId === messageId);
        result.events = { matchingEventCount: matches.length, providerReportedDelivered: matches.some(event => event.event === "delivered"),
            gmailInboxConfirmed: false, inboxConfirmationRequiresMailboxOwner: true, truncated: data.events.length >= 100 };
    }
    return { ...result, ready: !result.sender || result.sender.configuredSenderActive };
}

if (require.main === module) {
    Promise.resolve().then(async () => {
        const args = process.argv.slice(2);
        const options = parseArgs(args);
        let envFileLoaded = false;
        if (options.has("--env-file")) {
            const file = options.get("--env-file");
            const loaded = require("dotenv").config({ path: file, quiet: true, override: true });
            if (loaded.error) throw Object.assign(new Error("Environment file could not be read."), { code: "EMAIL_CONFIG" });
            envFileLoaded = true;
        }
        const result = await check(args, { envFileLoaded });
        console.log(JSON.stringify(result, null, 2));
        if (!result.ready) process.exitCode = 1;
    }).catch(error => {
        console.error(JSON.stringify({ ready: false, error: safeEmailError(error), sendsEmail: false, connectsDatabase: false, runsMigrations: false }));
        process.exitCode = 1;
    });
}
module.exports = { check, inspectEnvironment };
