const test = require("node:test");
const assert = require("node:assert/strict");
const nodemailer = require("nodemailer");
const { safeEmailError } = require("../utils/emailDiagnostics");

test("SMTP STARTTLS, cache rotation, missing configuration and safe diagnostics", async () => {
    const keys = ["EMAIL_PROVIDER", "BREVO_API_KEY", "EMAIL_FROM", "EMAIL_FROM_NAME", "SMTP_HOST", "SMTP_PORT", "SMTP_SECURE", "EMAIL_USER", "EMAIL", "EMAIL_PASS"];
    const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    const original = nodemailer.createTransport;
    const transports = [], sent = [];
    nodemailer.createTransport = options => {
        transports.push(options);
        return { sendMail: async mail => sent.push(mail), verify: async () => true };
    };
    delete require.cache[require.resolve("../utils/email")];
    const email = require("../utils/email");
    try {
        keys.forEach(key => delete process.env[key]);
        process.env.EMAIL_PROVIDER = "smtp";
        process.env.BREVO_API_KEY = "must-not-select-brevo";
        process.env.SMTP_PORT = "587";
        process.env.SMTP_SECURE = "false";
        process.env.EMAIL_USER = "test@example.invalid";
        process.env.EMAIL_PASS = "fake-first";
        await email("recipient@example.invalid", "subject", "body");
        assert.equal(transports[0].secure, false);
        assert.equal(transports[0].requireTLS, true);
        assert.equal(transports[0].host, "smtp.gmail.com");
        assert.equal(sent[0].from, process.env.EMAIL_USER);
        process.env.EMAIL_PASS = "fake-rotated";
        await email.verify();
        assert.equal(transports.length, 2);
        assert.equal(transports[1].auth.pass, "fake-rotated");
        process.env.SMTP_SECURE = "true";
        assert.throws(() => email.validateConfiguration(), { code: "EMAIL_CONFIG" });
        process.env.SMTP_SECURE = "false";
        delete process.env.EMAIL_PASS;
        await assert.rejects(email("unused", "unused", "unused"), { code: "EMAIL_CONFIG" });
        assert.equal(sent.length, 1);
        const error = Object.assign(new Error("secret recipient@example.invalid body"), { code: "EAUTH", responseCode: 535, response: "secret" });
        assert.deepEqual(safeEmailError(error), { code: "EAUTH", responseCode: 535 });
        let logged = "";
        const originalLog = console.log;
        try { console.log = (...args) => { logged += JSON.stringify(args); }; email.logConfiguration(); }
        finally { console.log = originalLog; }
        assert.ok(!logged.includes("test@example.invalid"));
        assert.ok(!logged.includes("fake-rotated"));
    } finally {
        nodemailer.createTransport = original;
        keys.forEach(key => saved[key] === undefined ? delete process.env[key] : process.env[key] = saved[key]);
        delete require.cache[require.resolve("../utils/email")];
    }
});

const withBrevo = async callback => {
    const keys = ["EMAIL_PROVIDER", "BREVO_API_KEY", "EMAIL_FROM", "EMAIL_FROM_NAME", "SMTP_HOST", "SMTP_PORT", "SMTP_SECURE", "EMAIL_USER", "EMAIL", "EMAIL_PASS"];
    const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    const originalFetch = global.fetch;
    keys.forEach(key => delete process.env[key]);
    process.env.BREVO_API_KEY = "test-brevo-api-key";
    process.env.EMAIL_FROM = "sender@example.invalid";
    process.env.EMAIL_FROM_NAME = "DJEMC Alumni Portal";
    delete require.cache[require.resolve("../utils/email")];
    const email = require("../utils/email");
    try { await callback(email); }
    finally {
        global.fetch = originalFetch;
        keys.forEach(key => saved[key] === undefined ? delete process.env[key] : process.env[key] = saved[key]);
        delete require.cache[require.resolve("../utils/email")];
    }
};

test("Brevo sends the existing text notification over HTTPS using configured sender details", async () => {
    await withBrevo(async email => {
        let request;
        global.fetch = async (url, options) => {
            request = { url, options };
            return { ok: true, status: 201, json: async () => ({ messageId: "<brevo-message-id>" }) };
        };
        assert.equal(email.validateConfiguration().provider, "brevo");
        const result = await email("alumni@example.invalid", "Account update", "Your account is ready.");
        assert.equal(result.messageId, "<brevo-message-id>");
        assert.equal(request.url, "https://api.brevo.com/v3/smtp/email");
        assert.equal(request.options.method, "POST");
        assert.equal(request.options.headers["api-key"], "test-brevo-api-key");
        assert.equal(request.options.headers["Content-Type"], "application/json");
        assert.equal(request.options.headers.Accept, "application/json");
        assert.deepEqual(JSON.parse(request.options.body), {
            sender: { email: "sender@example.invalid", name: "DJEMC Alumni Portal" },
            to: [{ email: "alumni@example.invalid" }],
            subject: "Account update",
            textContent: "Your account is ready."
        });
        let logged = "";
        const originalLog = console.log;
        try { console.log = (...args) => { logged += JSON.stringify(args); }; email.logConfiguration(); }
        finally { console.log = originalLog; }
        assert.ok(!logged.includes("test-brevo-api-key"));
        assert.ok(!logged.includes("sender@example.invalid"));
    });
});

test("Brevo API rejection is returned as a safe delivery failure", async () => {
    await withBrevo(async email => {
        global.fetch = async () => ({ ok: false, status: 401, json: async () => ({ message: "secret response" }) });
        await assert.rejects(email("recipient", "subject", "message"), error => error.code === "EMAIL_API" && error.responseCode === 401 && error.retryable === false && !error.message.includes("secret"));
    });
});

test("Brevo rejects missing configuration without making a request", async () => {
    await withBrevo(async email => {
        let requests = 0;
        global.fetch = async () => { requests++; throw new Error("unexpected request"); };
        process.env.EMAIL_PROVIDER = "brevo";
        delete process.env.BREVO_API_KEY;
        assert.throws(() => email.validateConfiguration(), { code: "EMAIL_CONFIG" });
        await assert.rejects(email("recipient", "subject", "message"), { code: "EMAIL_CONFIG" });
        assert.equal(requests, 0);
    });
});

test("Brevo network failures and timeouts reject without exposing request details", async () => {
    await withBrevo(async email => {
        global.fetch = async () => { throw new Error("private network details"); };
        await assert.rejects(email("recipient", "subject", "message"), error => error.code === "EMAIL_NETWORK" && error.retryable === false && !error.message.includes("private"));
        global.fetch = async () => { throw Object.assign(new Error("private timeout details"), { name: "TimeoutError" }); };
        await assert.rejects(email("recipient", "subject", "message"), error => error.code === "ETIMEDOUT" && error.retryable === false && !error.message.includes("private"));
    });
});

test("Brevo malformed success responses do not count as accepted emails", async () => {
    await withBrevo(async email => {
        global.fetch = async () => ({ ok: true, status: 201, json: async () => ({}) });
        await assert.rejects(email("recipient", "subject", "message"), { code: "EMAIL_RESPONSE" });
        global.fetch = async () => ({ ok: true, status: 201, json: async () => { throw new SyntaxError("bad json"); } });
        await assert.rejects(email("recipient", "subject", "message"), { code: "EMAIL_RESPONSE" });
    });
});

test('explicit Brevo overrides SMTP settings and preserves HTML, text, named recipients and subjects', async () => {
    await withBrevo(async email => {
        process.env.EMAIL_PROVIDER = 'brevo';
        process.env.EMAIL_USER = 'smtp@example.invalid';
        process.env.EMAIL_PASS = 'unused-smtp-secret';
        global.fetch = async (url, options) => {
            assert.equal(url, 'https://api.brevo.com/v3/smtp/email');
            assert.deepEqual(JSON.parse(options.body), {
                sender: { email: 'sender@example.invalid', name: 'DJEMC Alumni Portal' },
                to: [{ email: 'first@example.invalid', name: 'First' }, { email: 'second@example.invalid' }],
                subject: 'Existing subject', textContent: 'Plain text', htmlContent: '<p>Existing HTML</p>'
            });
            return Response.json({ messageId: '<accepted>' }, { status: 201 });
        };
        assert.equal(email.validateConfiguration().provider, 'brevo');
        await email([{ email: 'first@example.invalid', name: 'First' }, 'second@example.invalid'], 'Existing subject', 'Plain text', { html: '<p>Existing HTML</p>' });
    });
});

test('Brevo 429 honors Retry-After; permanent and ambiguous failures never switch providers or retry automatically', async () => {
    await withBrevo(async email => {
        let requests = 0;
        for (const status of [400, 401, 403, 408, 429, 500, 502, 503]) {
            global.fetch = async () => { requests++; return new Response('private provider body', { status, headers: { 'Retry-After': '120' } }); };
            await assert.rejects(email('recipient@example.invalid', 'subject', 'body'), error => {
                assert.equal(error.responseCode, status);
                assert.equal(error.retryable, status === 429);
                assert.equal(error.retryAfterMs, status === 429 ? 120000 : undefined);
                assert.doesNotMatch(error.message, /private/);
                return true;
            });
        }
        assert.equal(requests, 8);
        const future = new Date(Date.now() + 90000).toUTCString();
        global.fetch = async () => new Response('', { status: 429, headers: { 'Retry-After': future } });
        await assert.rejects(email('recipient@example.invalid', 'subject', 'body'), error => error.retryAfterMs > 85000 && error.retryAfterMs <= 90000);
    });
});

test('SMTP normalizes authentication, explicit transient rejection and ambiguous socket failures safely', async () => {
    const keys = ['EMAIL_PROVIDER', 'EMAIL_USER', 'EMAIL_PASS'];
    const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    const original = nodemailer.createTransport;
    let failure;
    nodemailer.createTransport = () => ({ sendMail: async () => { throw failure; } });
    delete require.cache[require.resolve('../utils/email')];
    const email = require('../utils/email');
    try {
        process.env.EMAIL_PROVIDER = 'smtp'; process.env.EMAIL_USER = 'fixture@example.invalid'; process.env.EMAIL_PASS = 'fake-secret';
        for (const [code, responseCode, retryable] of [['EAUTH', 535, false], ['EMESSAGE', 421, true], ['EDNS', undefined, true], ['ESOCKET', undefined, false], ['ETIMEDOUT', undefined, false]]) {
            failure = Object.assign(new Error('private SMTP recipient and credentials'), { code, responseCode });
            await assert.rejects(email('recipient@example.invalid', 'subject', 'text'), error => error.code === code && error.retryable === retryable && !error.message.includes('private'));
        }
    } finally {
        nodemailer.createTransport = original;
        keys.forEach(key => saved[key] === undefined ? delete process.env[key] : process.env[key] = saved[key]);
        delete require.cache[require.resolve('../utils/email')];
    }
});
