const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const db = require("../models");
const rateLimits = require("../utils/rateLimitStore");
const originalConsume = rateLimits.consumeRateLimit;
let rateMode = "allow";
const observed = [];
rateLimits.consumeRateLimit = async options => {
    observed.push(options);
    if (rateMode === "failure") throw new Error("private database diagnostics");
    return { allowed: rateMode === "allow", resetAt: Date.now() + 60000 };
};
const controller = require("../controllers/registrationOtpController");
rateLimits.consumeRateLimit = originalConsume;
const { digest } = require("../services/registrationOtp");
test.after(() => db.sequelize.close());
const response = () => ({ headers: {}, statusCode: 200, setHeader(key, value) { this.headers[key] = value; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

test("OTP rate limits bind IP, canonical Gmail and session without trusting forwarded headers", async () => {
    observed.length = 0; rateMode = "allow";
    const res = response(); let allowed = false;
    const token = "a".repeat(64);
    await controller.rateLimit("send")({ ip: "203.0.113.10", headers: { "x-forwarded-for": "spoofed" }, body: { email: "Sample.Graduate+tag@gmail.com", session_token: token } }, res, () => { allowed = true; });
    assert.equal(allowed, true); assert.equal(observed.length, 3);
    assert.equal(observed[0].key, digest("203.0.113.10"));
    assert.equal(observed[1].key, digest("samplegraduate@gmail.com"));
    assert.equal(observed[2].key, digest(token));
    assert.equal(res.headers["Cache-Control"], "no-store");
});
test("OTP limiter denies excessive requests and fails closed if its database is unavailable", async () => {
    for (const [mode, expected] of [["deny", 429], ["failure", 503]]) {
        rateMode = mode; const res = response(); let called = false;
        await controller.rateLimit("verify")({ ip: "203.0.113.10", body: {} }, res, () => { called = true; });
        assert.equal(called, false); assert.equal(res.statusCode, expected);
        assert.ok(!JSON.stringify(res.body).includes("private"));
        if (mode === "deny") assert.ok(Number(res.headers["Retry-After"]) > 0);
    }
    rateMode = "allow";
});
test("OTP API delegates resend explicitly, exposes safe errors and never returns exception details", async () => {
    const original = controller.otp.send;
    try {
        controller.otp.send = async (email, session, options) => { assert.equal(email, "fixture@gmail.com"); assert.equal(session, "a".repeat(64)); assert.deepEqual(options, { resend: true }); return { status: "sent", verified: false }; };
        const res = response();
        await controller.resend({ body: { email: "fixture@gmail.com", session_token: "a".repeat(64) } }, res, error => { throw error; });
        assert.deepEqual(res.body, { status: "sent", verified: false });
        controller.otp.send = async () => { throw Object.assign(new Error("private SQL and credentials"), { original: { code: "ER_BAD_FIELD_ERROR" } }); };
        let failure;
        await controller.send({ body: {} }, response(), error => { failure = error; });
        assert.equal(failure.status, 503); assert.ok(!failure.publicMessage.includes("credentials"));
    } finally { controller.otp.send = original; }
});
test("ordinary production startup performs read-only readiness checks and refuses sync", async () => {
    const source = fs.readFileSync(require.resolve("../server"), "utf8");
    const code = source.slice(source.indexOf("const ensureDatabaseReady ="), source.indexOf("const listRoutes ="));
    for (const shouldSync of [false, true]) {
        const reads = [];
        const context = { isProduction: true, shouldSync, process: { env: { JWT_SECRET: "fixture" } },
            db: { sequelize: { authenticate: async () => reads.push("authenticate") }, EmployerProfile: { findOne: async options => { assert.equal(options.where.id, -1); reads.push("employer"); } } },
            verifyAuthSchema: async () => reads.push("auth"), verifyRegistrationOtpSchema: async () => reads.push("otp") };
        const run = vm.runInNewContext(`${code}\nensureDatabaseReady`, context);
        if (shouldSync) { await assert.rejects(run(), /not allowed in production/); assert.equal(reads.length, 0); }
        else { await run(); assert.deepEqual(reads, ["authenticate", "employer", "otp", "auth"]); }
    }
});
