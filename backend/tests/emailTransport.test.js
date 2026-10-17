const test = require("node:test");
const assert = require("node:assert/strict");
const nodemailer = require("nodemailer");
const { safeEmailError } = require("../utils/emailDiagnostics");

test("SMTP STARTTLS, cache rotation, missing configuration and safe diagnostics", async () => {
    const keys = ["SMTP_HOST", "SMTP_PORT", "SMTP_SECURE", "EMAIL_USER", "EMAIL", "EMAIL_PASS", "EMAIL_FROM"];
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
