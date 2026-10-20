const test = require("node:test");
const assert = require("node:assert/strict");
const db = require("../models");
const email = require("../utils/email");
const worker = require("../workers/emailQueueWorker");
const { safeEmailError, safeMessageId, requiresDeliveryReview } = require("../utils/emailDiagnostics");
test.after(() => db.sequelize.close());

async function fixture(run) {
    const keys = ["EMAIL_PROVIDER", "BREVO_API_KEY", "EMAIL_FROM", "EMAIL_FROM_NAME", "EMAIL_REQUEST_TIMEOUT_MS"];
    const env = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    const originalFetch = global.fetch, originalTransport = require("nodemailer").createTransport;
    const changes = [];
    const change = (target, key, value) => { changes.push([target, key, target[key]]); target[key] = value; };
    const requests = [];
    Object.assign(process.env, { EMAIL_PROVIDER: "brevo", BREVO_API_KEY: "fixture-api-key", EMAIL_FROM: "sender@example.invalid", EMAIL_FROM_NAME: "DJEMC Portal", EMAIL_REQUEST_TIMEOUT_MS: "1000" });
    require("nodemailer").createTransport = () => { throw Error("Brevo must never initialize SMTP"); };
    global.fetch = async (url, options) => {
        requests.push({ url, options, body: JSON.parse(options.body) });
        return Response.json({ messageId: "<fixture-accepted@brevo.invalid>" }, { status: 201 });
    };
    try { await run({ change, requests }); }
    finally {
        for (const [target, key, value] of changes.reverse()) target[key] = value;
        global.fetch = originalFetch;
        require("nodemailer").createTransport = originalTransport;
        keys.forEach(key => env[key] === undefined ? delete process.env[key] : process.env[key] = env[key]);
    }
}

test("Brevo is explicit; merely adding a key never silently changes the legacy provider", () => fixture(async () => {
    delete process.env.EMAIL_PROVIDER;
    // Validation only: this does not initialize/contact SMTP.
    const user = process.env.EMAIL_USER, pass = process.env.EMAIL_PASS;
    try {
        process.env.EMAIL_USER = "fixture@example.invalid"; process.env.EMAIL_PASS = "fixture-smtp";
        assert.equal(email.validateConfiguration().provider, "smtp");
        process.env.EMAIL_PROVIDER = "resend";
        assert.throws(() => email.validateConfiguration(), { code: "EMAIL_CONFIG" });
    } finally {
        user === undefined ? delete process.env.EMAIL_USER : process.env.EMAIL_USER = user;
        pass === undefined ? delete process.env.EMAIL_PASS : process.env.EMAIL_PASS = pass;
    }
}));

test("missing keys, invalid sender configuration and invalid timeout fail before HTTP or SMTP", () => fixture(async ({ requests }) => {
    for (const [key, value] of [["BREVO_API_KEY", ""], ["EMAIL_FROM", "bad"], ["EMAIL_FROM", "sender@example.invalid,other@example.invalid"], ["EMAIL_FROM_NAME", ""], ["EMAIL_FROM_NAME", "Bad\r\nBcc: extra"], ["EMAIL_REQUEST_TIMEOUT_MS", "0"], ["EMAIL_REQUEST_TIMEOUT_MS", "30001"], ["EMAIL_REQUEST_TIMEOUT_MS", "1.5"]]) {
        const prior = process.env[key]; process.env[key] = value;
        try { await assert.rejects(email("recipient@example.invalid", "Subject", "Text"), { code: "EMAIL_CONFIG" }); }
        finally { process.env[key] = prior; }
    }
    assert.equal(requests.length, 0);
}));

test("recipient/header injection and malformed messages cannot reach any transport", () => fixture(async ({ requests }) => {
    for (const to of ["bad", "valid@example.invalid,other@example.invalid", "Name <valid@example.invalid>", "valid@example.invalid\r\nBcc: other@example.invalid", [], ["valid@example.invalid", "bad"], { email: "valid@example.invalid", name: "Name\nInjected" }, { address: "other@example.invalid" }]) {
        await assert.rejects(email(to, "Subject", "Text"), { code: "EMAIL_RECIPIENT" });
    }
    await assert.rejects(email("recipient@example.invalid", "Subject\r\nBcc: other", "Text"), { code: "EMAIL_MESSAGE" });
    await assert.rejects(email("recipient@example.invalid", "Subject", { private: "object" }), { code: "EMAIL_MESSAGE" });
    assert.equal(requests.length, 0);
}));

test("HTTPS request preserves text/HTML and recipients while blocking redirects and arbitrary recipient properties", () => fixture(async ({ requests }) => {
    await email([{ email: " First+tag@example.invalid ", name: "First", bcc: [{ email: "ignored@example.invalid" }] }, "second@example.invalid"], "Existing subject", "<script>literal plain text</script>", { html: "<p>Existing HTML</p>", sender: { email: "ignored@example.invalid" } });
    const request = requests[0];
    assert.equal(request.url, "https://api.brevo.com/v3/smtp/email");
    assert.equal(request.options.method, "POST");
    assert.equal(request.options.redirect, "error");
    assert.ok(request.options.signal instanceof AbortSignal);
    assert.equal(request.options.headers["api-key"], "fixture-api-key");
    assert.deepEqual(request.body.sender, { email: "sender@example.invalid", name: "DJEMC Portal" });
    assert.deepEqual(request.body.to, [{ email: "First+tag@example.invalid", name: "First" }, { email: "second@example.invalid" }]);
    assert.equal(request.body.textContent, "<script>literal plain text</script>");
    assert.equal(request.body.htmlContent, "<p>Existing HTML</p>");
    await email("recipient@example.invalid", "HTML only", undefined, { html: "<p>HTML</p>" });
    assert.equal(requests[1].body.textContent, undefined);
}));

test("configured timeout aborts a pending HTTP call without fallback or uncertain automatic retry", () => fixture(async () => {
    let calls = 0;
    global.fetch = async (_url, { signal }) => {
        calls++;
        return new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    };
    const keepAlive = setTimeout(() => {}, 1500);
    try {
        await assert.rejects(email("recipient@example.invalid", "Subject", "Text"), error => error.code === "ETIMEDOUT" && error.deliveryUnknown && !error.retryable);
        assert.equal(calls, 1);
    } finally { clearTimeout(keepAlive); }
}));

test("late response-body timeout and 5xx remain unknown; API 400/401/403 are terminal and 429 alone retries", () => fixture(async () => {
    global.fetch = async () => ({ ok: true, status: 201, json: async () => { throw Object.assign(new Error("private response token"), { name: "AbortError" }); } });
    await assert.rejects(email("recipient@example.invalid", "Subject", "Text"), error => error.code === "ETIMEDOUT" && error.deliveryUnknown);
    for (const status of [400, 401, 403, 408, 429, 500, 502, 503]) {
        global.fetch = async () => new Response("private upstream body", { status, headers: { "Retry-After": "90" } });
        await assert.rejects(email("recipient@example.invalid", "Subject", "Text"), error => {
            assert.equal(error.retryable, status === 429);
            assert.equal(requiresDeliveryReview(JSON.stringify(safeEmailError(error))), status === 408 || status >= 500);
            assert.equal(error.retryAfterMs, status === 429 ? 90000 : undefined);
            assert.doesNotMatch(JSON.stringify(safeEmailError(error)), /private|recipient|fixture-api-key/);
            return true;
        });
    }
}));

test("existing queue rows retain payload/key/attempt semantics; accepted IDs are available for reconciliation", () => fixture(async ({ change, requests }) => {
    const job = { id: 31, to: "recipient@example.invalid", subject: "Existing subject", message: "Existing message", dedupe_key: "event:31", status: "processing", attempts: 1, max_attempts: 5, processing_started_at: new Date(), scheduled_at: new Date() };
    change(db.EmailQueueJob, "findOne", async () => job);
    change(db.EmailQueueJob, "update", async (values, { where }) => { assert.equal(where.attempts, job.attempts); Object.assign(job, values); return [1]; });
    const originalLog = console.log, logs = [];
    console.log = (...values) => logs.push(values);
    try {
        await worker.processJob(job);
        assert.equal(job.status, "sent"); assert.equal(job.attempts, 1); assert.equal(job.dedupe_key, "event:31");
        assert.ok(job.sent_at instanceof Date); assert.equal(job.last_error, null);
        assert.equal(requests[0].body.textContent, "Existing message");
        assert.match(JSON.stringify(logs), /fixture-accepted@brevo.invalid/);
        assert.doesNotMatch(JSON.stringify(logs), /Existing message|recipient@example|fixture-api-key/);
    } finally { console.log = originalLog; }
}));

test("queue applies Retry-After to HTTP 429 while authentication and uncertain failures remain held", () => fixture(async ({ change }) => {
    let job;
    change(db.EmailQueueJob, "findOne", async () => job);
    change(db.EmailQueueJob, "update", async values => { Object.assign(job, values); return [1]; });
    for (const status of [400, 401, 403, 429, 500, 503]) {
        job = { id: status, status: "processing", to: "recipient@example.invalid", subject: "Existing", message: "Existing text", attempts: 1, max_attempts: 5, scheduled_at: new Date(), processing_started_at: new Date() };
        global.fetch = async () => new Response("private error", { status, headers: { "Retry-After": "120" } });
        const start = Date.now(); await worker.processJob(job);
        assert.equal(job.status, status === 429 ? "pending" : "failed");
        if (status === 429) assert.ok(job.scheduled_at.getTime() >= start + 120000);
        assert.equal(job.attempts, 1); assert.doesNotMatch(job.last_error, /private error/);
    }
}));

test("message ID and diagnostics never accept unbounded identifiers or raw upstream errors", () => {
    assert.equal(safeMessageId("<receipt@relay.example.invalid>"), "<receipt@relay.example.invalid>");
    for (const id of ["id\nprivate", "x".repeat(513), {}, null]) assert.equal(safeMessageId(id), undefined);
    for (const value of [null, "legacy private error", "{}", JSON.stringify({ code: "EMAIL_AMBIGUOUS" }), JSON.stringify({ code: "EMAIL_EXHAUSTED" })]) assert.equal(requiresDeliveryReview(value), true);
});

test("provider acceptance followed by a database outage records a safe receipt and never schedules a second send", () => fixture(async ({ change, requests }) => {
    const job = { id: 77, to: "recipient@example.invalid", subject: "Subject", message: "Private reset token fixture", status: "processing", attempts: 1, max_attempts: 5, processing_started_at: new Date() };
    change(db.EmailQueueJob, "findOne", async () => job);
    let writes = 0;
    change(db.EmailQueueJob, "update", async values => { writes++; assert.equal(values.status, "sent"); throw Error("private SQL details"); });
    const originalError = console.error, logs = [];
    console.error = (...values) => logs.push(values);
    try {
        await worker.processJob(job);
        assert.equal(requests.length, 1); assert.equal(writes, 1); assert.equal(job.status, "processing");
        assert.match(JSON.stringify(logs), /fixture-accepted@brevo.invalid/);
        assert.doesNotMatch(JSON.stringify(logs), /Private reset token|private SQL|recipient@example|fixture-api-key/);
    } finally { console.error = originalError; }
}));
