const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { check, inspectEnvironment } = require("../scripts/checkBrevoStaging");

const env = {
    EMAIL_PROVIDER: "brevo", BREVO_API_KEY: "fixture-private-key",
    EMAIL_FROM: "configured@example.invalid", EMAIL_FROM_NAME: "Fixture Sender",
    BREVO_TEST_GMAIL: "authorized.fixture@gmail.com", REGISTRATION_OTP_SECRET: "x".repeat(40),
    DB_HOST: "127.0.0.1", DB_PORT: "3306", DB_NAME: "djemc_alumni_staging",
    DB_USER: "staging_user", DB_PASS: "fixture-db-password", NODE_ENV: "development"
};

test("valid local staging configuration is read-only and never sends email or connects to a database", async () => {
    let networkCalls = 0;
    const result = await check([], { env: { ...env }, envFileLoaded: true, fetch: () => { networkCalls++; throw Error("unexpected network"); } });
    assert.equal(result.ready, true);
    assert.equal(result.configuration.envFileLoaded, true);
    assert.equal(result.configuration.stagingDatabaseConfigured, true);
    assert.equal(result.stagingIsolationSafe, true);
    assert.equal(result.apiReadAttempted, false);
    assert.equal(networkCalls, 0);
    for (const property of ["sendsEmail", "connectsDatabase", "initializesSmtp", "runsMigrations"]) assert.equal(result.configuration[property], false);
});

test("missing Brevo API key does not validate as ready or make a request", async () => {
    for (const key of ["", "REPLACE_WITH_PRIVATE_BREVO_REST_API_KEY", "key with spaces"]) {
        const result = await check([], { env: { ...env, BREVO_API_KEY: key }, fetch: () => { throw Error("unexpected network"); } });
        assert.equal(result.ready, false);
        assert.equal(result.apiReadAttempted, false);
    }
    assert.equal(inspectEnvironment({ ...env, BREVO_API_KEY: "" }).present.BREVO_API_KEY, false);
});

test("invalid or missing provider is rejected without transport initialization", async () => {
    for (const provider of ["smtp", "resend", ""]) {
        const result = await check([], { env: { ...env, EMAIL_PROVIDER: provider }, fetch: () => { throw Error("unexpected network"); } });
        assert.equal(result.ready, false);
        assert.equal(result.configuration.providerBrevo, false);
        assert.equal(result.configuration.initializesSmtp, false);
    }
});

test("invalid or missing sender configuration is never reported as ready", async () => {
    for (const sender of ["", "bad", "a@example.com,b@example.com", "a@example.com\r\nBcc:x@y.com"]) {
        const result = await check([], { env: { ...env, EMAIL_FROM: sender } });
        assert.equal(result.ready, false);
        assert.equal(result.configuration.senderConfigurationValid, false);
    }
});

test("OTP secret and authorized test Gmail are required before staging is ready", async () => {
    for (const changes of [{ REGISTRATION_OTP_SECRET: "short" }, { BREVO_TEST_GMAIL: "not-a-gmail-address@example.com" }, { BREVO_TEST_GMAIL: "" }]) {
        const result = await check([], { env: { ...env, ...changes } });
        assert.equal(result.ready, false);
        assert.equal(result.apiReadAttempted, false);
    }
});

test("missing staging database settings fail closed", async () => {
    for (const key of ["DB_HOST", "DB_NAME", "DB_USER"]) {
        const result = await check([], { env: { ...env, [key]: "" } });
        assert.equal(result.ready, false);
        assert.equal(result.configuration.stagingDatabaseConfigured, false);
        assert.equal(result.apiReadAttempted, false);
    }
    for (const port of ["0", "65536", "nope"]) {
        const result = await check([], { env: { ...env, DB_PORT: port } });
        assert.equal(result.ready, false);
        assert.equal(result.configuration.stagingDatabasePortValid, false);
    }
});

test("production database settings are detected and prevent all provider API reads", async () => {
    const dangerous = [
        { DB_HOST: "primary-prod-db.example.com" },
        { DB_HOST: "mysql.aivencloud.com" },
        { DB_NAME: "defaultdb" },
        { NODE_ENV: "production" },
        { DATABASE_URL: "mysql://user:secret@db.aivencloud.com/defaultdb" }
    ];
    for (const change of dangerous) {
        let calls = 0;
        const result = await check(["--sender"], { env: { ...env, ...change }, fetch: () => { calls++; throw Error("must not access provider"); } });
        assert.equal(result.ready, false);
        assert.equal(result.configuration.productionDatabaseDetected, true);
        assert.equal(result.apiReadAttempted, false);
        assert.equal(calls, 0);
    }
});

test("remote databases require an explicit isolated staging marker and Aiven/production targets always fail", () => {
    assert.equal(inspectEnvironment({ ...env, DB_HOST: "staging.mysql.example.net" }).stagingDatabaseSafe, false);
    assert.equal(inspectEnvironment({ ...env, DB_HOST: "staging.mysql.example.net", STAGING_DB_ISOLATED: "true" }).stagingDatabaseSafe, true);
    assert.equal(inspectEnvironment({ ...env, DB_HOST: "staging.mysql.aivencloud.com", STAGING_DB_ISOLATED: "true" }).stagingDatabaseSafe, false);
});

test("missing environment file is reported safely and credentials never appear in diagnostics", async () => {
    const script = path.join(__dirname, "..", "scripts", "checkBrevoStaging.js");
    const missing = spawnSync(process.execPath, [script, "--env-file", path.join(__dirname, "missing-staging-env-file")], { encoding: "utf8" });
    assert.notEqual(missing.status, 0);
    assert.doesNotMatch(missing.stdout + missing.stderr, /fixture-private-key|secret|password/i);
    const result = await check([], { env: { ...env }, envFileLoaded: false });
    assert.equal(result.configuration.envFileLoaded, false);
    const printed = JSON.stringify(result);
    for (const secret of [env.BREVO_API_KEY, env.EMAIL_FROM, env.BREVO_TEST_GMAIL, env.DB_PASS, env.DB_USER]) assert.ok(!printed.includes(secret));
});

test("optional sender check performs a scoped read-only GET and never reveals addresses", async () => {
    const result = await check(["--sender"], { env: { ...env }, fetch: async (url, options) => {
        assert.equal(url, "https://api.brevo.com/v3/senders");
        assert.equal(options.method, "GET"); assert.equal(options.redirect, "error");
        assert.equal(options.headers["api-key"], env.BREVO_API_KEY);
        return Response.json({ senders: [{ email: "other@example.invalid", active: true }, { email: env.EMAIL_FROM, active: true }] });
    } });
    assert.equal(result.ready, true);
    assert.equal(result.sender.configuredSenderActive, true);
    assert.doesNotMatch(JSON.stringify(result), /other@example.invalid|configured@example.invalid|fixture-private-key/);
});

test("event reads require the authorized Gmail and message ID and filter returned events", async () => {
    const id = "<fixture-receipt@relay.invalid>";
    const result = await check(["--events", "--message-id", id], { env: { ...env }, fetch: async url => {
        assert.equal(url.searchParams.get("email"), env.BREVO_TEST_GMAIL);
        assert.equal(url.searchParams.get("messageId"), id);
        return Response.json({ events: [
            { email: "unintended@gmail.com", messageId: id, event: "delivered" },
            { email: env.BREVO_TEST_GMAIL, messageId: id, event: "delivered", reason: "private provider details" }
        ] });
    } });
    assert.equal(result.events.matchingEventCount, 1);
    assert.equal(result.events.providerReportedDelivered, true);
    assert.equal(result.events.gmailInboxConfirmed, false);
    assert.doesNotMatch(JSON.stringify(result), /unintended|private provider|fixture-private-key/);
});

test("invalid configuration, unsupported send mode, failed API responses, and malformed replies fail safely", async () => {
    for (const args of [["--send"], ["--events"], ["--events", "--message-id", "bad\nidentifier"], ["--message-id", "<receipt>"]]) {
        await assert.rejects(check(args, { env: { ...env }, fetch: () => { throw Error("must not network"); } }), { code: "EMAIL_CONFIG" });
    }
    for (const status of [401, 403, 429, 503]) {
        let count = 0;
        await assert.rejects(check(["--sender"], { env: { ...env }, fetch: async () => { count++; return new Response("private secret response", { status }); } }), error => error.code === "EMAIL_API" && error.responseCode === status && !error.message.includes("private"));
        assert.equal(count, 1);
    }
    await assert.rejects(check(["--sender"], { env: { ...env }, fetch: async () => Response.json({ unexpected: true }) }), { code: "EMAIL_RESPONSE" });
});
