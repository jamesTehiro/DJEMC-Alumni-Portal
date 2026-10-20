const test = require("node:test");
const assert = require("node:assert/strict");
const Sequelize = require("sequelize");
const { createRegistrationOtp, OTP_TTL, GRANT_TTL, COOLDOWN, SEND_WINDOW, digest } = require("../services/registrationOtp");
const { emailKey, isGmail } = require("../utils/registrationEmail");
process.env.REGISTRATION_OTP_SECRET = "test-only-registration-secret-at-least-32-bytes";
const email = "sample.graduate+portal@gmail.com";
const session = "a".repeat(64);

function fixture(sendTransport) {
    let time = 1800000000123, sequence = 14257, account = null, sendFailure = null;
    let rows = new Map(), queue = Promise.resolve();
    const sent = [];
    const attach = data => {
        Object.defineProperty(data, "update", { enumerable: false, value: async values => { Object.assign(data, values); return data; } });
        return data;
    };
    const db = {
        Sequelize,
        User: { findOne: async () => account },
        RegistrationEmailVerification: {
            findByPk: async key => rows.get(key),
            update: async (values, { where }) => {
                const row = rows.get(where.email_key);
                if (!row || Object.entries(where).some(([key, value]) => row[key] !== value)) return [0];
                await row.update(values); return [1];
            }
        },
        sequelize: {
            query: async (_sql, { replacements }) => {
                const [key, recipient, sessionHash] = replacements;
                if (!rows.has(key) && ![...rows.values()].some(row => row.session_hash === sessionHash)) rows.set(key, attach({ email_key: key, email: recipient,
                    session_hash: sessionHash, status: "failed", sent_at: new Date(0), resend_history: [], failed_attempts: 0,
                    otp_hash: null, verified_at: null, consumed_at: null }));
            },
            transaction: async callback => {
                const prior = queue;
                let release;
                queue = new Promise(resolve => { release = resolve; });
                await prior;
                const before = new Map([...rows].map(([key, row]) => [key, structuredClone(row)]));
                try { return await callback({ LOCK: { UPDATE: "UPDATE" } }); }
                catch (error) { rows = new Map([...before].map(([key, row]) => [key, attach(row)])); throw error; }
                finally { release(); }
            }
        }
    };
    const service = createRegistrationOtp({ db, now: () => time, randomInt: () => sequence++, sendEmail: async (to, subject, text, options) => {
        if (sendFailure) throw sendFailure;
        sent.push({ to, subject, text, options });
        return sendTransport?.(to, subject, text, options);
    } });
    return { db, service, sent, row: () => rows.get(emailKey(email)), advance: ms => { time += ms; },
        account: value => { account = value; }, failure: value => { sendFailure = value; },
        code: () => sent.at(-1).text.match(/^\d{6}$/m)[0] };
}
const rejectsCode = (promise, code) => assert.rejects(promise, error => error.code === code);

test("OTP and replacement travel through the real central Brevo adapter with exact Gmail binding", async () => {
    const keys = ["EMAIL_PROVIDER", "BREVO_API_KEY", "EMAIL_FROM", "EMAIL_FROM_NAME"];
    const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    const originalFetch = global.fetch, requests = [];
    Object.assign(process.env, { EMAIL_PROVIDER: "brevo", BREVO_API_KEY: "fixture-api-key", EMAIL_FROM: "sender@example.invalid", EMAIL_FROM_NAME: "DJEMC Portal" });
    global.fetch = async (url, options) => {
        assert.equal(url, "https://api.brevo.com/v3/smtp/email");
        assert.equal(options.headers["api-key"], "fixture-api-key");
        requests.push(JSON.parse(options.body));
        return Response.json({ messageId: "<fixture-otp>" }, { status: 201 });
    };
    try {
        const f = fixture(require("../utils/registrationOtpEmail"));
        await f.service.send(email, session);
        const first = f.code();
        f.advance(COOLDOWN);
        await f.service.send(email, session, { resend: true });
        assert.equal(requests.length, 2);
        for (const request of requests) {
            assert.deepEqual(request.to, [{ email }]);
            assert.match(request.htmlContent, /Verify your Gmail address/);
            assert.match(request.textContent, /valid for 5 minutes/);
        }
        assert.notEqual(first, f.code());
        await rejectsCode(f.service.verify(email, session, first), "OTP_INCORRECT");
        assert.equal((await f.service.verify(email, session, f.code())).verified, true);
        assert.equal(f.row().otp_hash, null);
        process.env.EMAIL_PROVIDER = "smtp";
        await assert.rejects(require("../utils/registrationOtpEmail")(email, "OTP", "fixture"), { code: "EMAIL_CONFIG" });
    } finally {
        global.fetch = originalFetch;
        keys.forEach(key => saved[key] === undefined ? delete process.env[key] : process.env[key] = saved[key]);
    }
});

test("Gmail policy is shared with the frontend and rejects recipient injection", async () => {
    const frontend = await import("../../frontend/alumni-portal/src/utils/registrationEmail.js");
    for (const value of [email, " SAMPLE.GRADUATE@gmail.com ", "test@gmail.com", "test@googlemail.com", "name@outlook.com", "a..b@gmail.com", "a@gmail.com,b@gmail.com", "A <test@gmail.com>", "test@gmail.com\r\nBcc: other@gmail.com", [email], { email }]) {
        assert.equal(isGmail(value), frontend.isRegistrationGmail(value));
    }
    assert.equal(emailKey(email), "samplegraduate@gmail.com");
    assert.equal(emailKey("Sample.Graduate+legacy@googlemail.com"), emailKey(email));
    const f = fixture();
    await rejectsCode(f.service.send("test@gmail.com,other@gmail.com", session), "INVALID_GMAIL");
    assert.equal(f.sent.length, 0);
});
test("approved, pending, rejected and other-role accounts cannot start duplicate registration", async () => {
    for (const role of ["alumni", "employer", "admin"]) for (const status of ["pending", "verified", "rejected"]) {
        const f = fixture(); f.account({ id: 1, role, account_status: status });
        await rejectsCode(f.service.send(email, session), "EMAIL_REGISTERED");
        assert.equal(f.sent.length, 0); assert.equal(f.row(), undefined);
    }
});
test("new Gmail receives the specified Brevo template and only keyed hashes are persisted", async () => {
    const f = fixture(); const result = await f.service.send(` ${email.toUpperCase()} `, session);
    assert.equal(f.sent[0].to, email);
    assert.equal(f.sent[0].subject, "DJEMC Alumni Registration — Email Verification Code");
    assert.match(f.sent[0].options.html, /014257/);
    assert.match(f.sent[0].text, /This code is valid for 5 minutes/);
    assert.match(f.row().otp_hash, /^[a-f0-9]{64}$/);
    assert.equal(f.row().session_hash, digest(session));
    assert.equal(result.verified, false); assert.equal(result.registration_authorization, undefined);
    assert.equal(new Date(result.expires_at) - new Date(result.server_time), OTP_TTL);
    assert.ok(!JSON.stringify(result).includes(f.code()));
});
test("correct OTP issues a short-lived session/email-bound authorization recoverable after refresh", async () => {
    const f = fixture(); await f.service.send(email, session);
    const result = await f.service.verify(email, session, f.code());
    assert.equal(result.verified, true); assert.equal(f.row().otp_hash, null);
    assert.equal(typeof result.registration_authorization, "string");
    const restored = await f.service.status(email, session);
    assert.equal(restored.registration_authorization, result.registration_authorization);
    await rejectsCode(f.db.sequelize.transaction(tx => f.service.consume(email, session, "frontend-isVerified", tx)), "GMAIL_VERIFICATION_REQUIRED");
    await rejectsCode(f.db.sequelize.transaction(tx => f.service.consume("another@gmail.com", session, result.registration_authorization, tx)), "GMAIL_VERIFICATION_REQUIRED");
    await rejectsCode(f.db.sequelize.transaction(tx => f.service.consume(email, "b".repeat(64), result.registration_authorization, tx)), "GMAIL_VERIFICATION_REQUIRED");
    await rejectsCode(f.service.status(email, "b".repeat(64)), "INVALID_SESSION");
});
test("five incorrect or malformed attempts persist and prevent even a correct sixth guess", async () => {
    const f = fixture(); await f.service.send(email, session);
    for (const code of ["000000", 14257, "bad", "123", "111111"]) await assert.rejects(f.service.verify(email, session, code), /Incorrect code/);
    assert.equal(f.row().failed_attempts, 5);
    await rejectsCode(f.service.verify(email, session, f.code()), "OTP_ATTEMPTS");
    assert.equal(f.row().status, "sent");
});
test("OTP expires at five minutes and verified authorization expires at ten minutes", async () => {
    const f = fixture(); await f.service.send(email, session); f.advance(OTP_TTL);
    await rejectsCode(f.service.verify(email, session, f.code()), "OTP_EXPIRED");
    await f.service.send(email, session, { resend: true });
    const verified = await f.service.verify(email, session, f.code()); f.advance(GRANT_TTL);
    assert.equal((await f.service.status(email, session)).verified, false);
    await rejectsCode(f.db.sequelize.transaction(tx => f.service.consume(email, session, verified.registration_authorization, tx)), "GMAIL_VERIFICATION_REQUIRED");
});
test("resend cooldown and three resends in a rolling 15 minutes survive new sessions", async () => {
    const f = fixture(); await f.service.send(email, session); const oldCode = f.code();
    await rejectsCode(f.service.send(email, session, { resend: true }), "OTP_COOLDOWN");
    for (let i = 0; i < 3; i++) { f.advance(COOLDOWN); await f.service.send(email, session, { resend: true }); }
    await rejectsCode(f.service.verify(email, session, oldCode), "OTP_INCORRECT");
    f.advance(COOLDOWN);
    await rejectsCode(f.service.send(email, "b".repeat(64)), "OTP_SEND_LIMIT");
    assert.equal(f.sent.length, 4);
    f.advance(SEND_WINDOW);
    await f.service.send(email, session, { resend: true });
    assert.equal(f.sent.length, 5);
});
test("simultaneous repeated initial requests send a single email", async () => {
    const f = fixture();
    await Promise.all(Array.from({ length: 8 }, () => f.service.send(email, session)));
    assert.equal(f.sent.length, 1);
    assert.equal(f.row().resend_history.length, 0);
});
test("a replacement session invalidates the previous verified grant and exact delivery address binding", async () => {
    const f = fixture(); await f.service.send(email, session);
    const verified = await f.service.verify(email, session, f.code());
    f.advance(COOLDOWN);
    await f.service.send(email, "b".repeat(64));
    await rejectsCode(f.db.sequelize.transaction(tx => f.service.consume(email, session, verified.registration_authorization, tx)), "INVALID_SESSION");
    await rejectsCode(f.service.verify("samplegraduate@gmail.com", "b".repeat(64), f.code()), "INVALID_SESSION");
});
test("Brevo rejection statuses are safely classified, invalidate the code, and preserve the session", async () => {
    const categories = new Map([[401, "brevo_unauthorized"], [403, "brevo_forbidden"], [429, "brevo_rate_limited"], [500, "brevo_server_error"], [503, "brevo_server_error"]]);
    for (const [responseCode, failureCategory] of categories) {
        const f = fixture();
        f.failure(Object.assign(new Error("private provider response"), { code: "EMAIL_API", responseCode, retryAfterMs: responseCode === 429 ? 120000 : undefined }));
        await assert.rejects(f.service.send(email, session), error => error.code === "OTP_DELIVERY_FAILED" && error.failureCategory === failureCategory && error.providerStatus === responseCode && error.retryAfter === (responseCode === 429 ? 120 : 60));
        assert.equal(f.row().otp_hash, null); assert.equal(f.row().status, "failed");
        assert.equal((await f.service.status(email, session)).status, "failed");
        await rejectsCode(f.service.verify(email, session, "014257"), "OTP_NOT_READY");
        f.advance(responseCode === 429 ? 120000 : COOLDOWN);
        await rejectsCode(f.service.send(email, session, { resend: true }), "OTP_DELIVERY_FAILED");
        assert.equal(f.sent.length, 0);
    }
});

test("Brevo timeouts are classified without status; database reservation failures stay private", async () => {
    const f = fixture();
    f.failure(Object.assign(new Error("private timeout details"), { code: "ETIMEDOUT", deliveryUnknown: true }));
    await assert.rejects(f.service.send(email, session), error => error.code === "OTP_DELIVERY_FAILED" && error.failureCategory === "brevo_timeout" && error.providerStatus === undefined);
    assert.equal(f.row().otp_hash, null);
    assert.equal((await f.service.status(email, session)).status, "failed");

    const brokenDb = fixture();
    brokenDb.db.User.findOne = async () => { throw new Error("private SQL details"); };
    await assert.rejects(brokenDb.service.send(email, session), error => error.failureCategory === "database_error" && !error.publicMessage);
    assert.equal(brokenDb.row(), undefined);

    const failedReservation = fixture();
    failedReservation.db.sequelize.query = async () => { throw new Error("private reservation SQL details"); };
    await assert.rejects(failedReservation.service.send(email, session), error => error.failureCategory === "database_error" && !error.publicMessage);
    assert.equal(failedReservation.row(), undefined);
    await rejectsCode(failedReservation.service.status(email, session), "INVALID_SESSION");
});

test("OTP unavailable diagnoses weak secret and malformed history; failed reservation rolls back", async () => {
    const originalSecret = process.env.REGISTRATION_OTP_SECRET;
    try {
        const missingSecret = fixture();
        process.env.REGISTRATION_OTP_SECRET = "too-short";
        await assert.rejects(missingSecret.service.send(email, session), error => error.code === "OTP_UNAVAILABLE" && error.failureCategory === "otp_secret_missing_or_short");
        assert.equal(missingSecret.row(), undefined);
        await rejectsCode(missingSecret.service.status(email, session), "INVALID_SESSION");

        process.env.REGISTRATION_OTP_SECRET = originalSecret;
        const malformedHistory = fixture();
        const query = malformedHistory.db.sequelize.query;
        malformedHistory.db.sequelize.query = async (...args) => {
            await query(...args);
            const [key] = args[1].replacements;
            malformedHistory.row().resend_history = "not-json";
        };
        await assert.rejects(malformedHistory.service.send(email, session), error => error.code === "OTP_UNAVAILABLE" && error.failureCategory === "resend_history_invalid");
        assert.equal(malformedHistory.row(), undefined);
        await rejectsCode(malformedHistory.service.status(email, session), "INVALID_SESSION");
    } finally { process.env.REGISTRATION_OTP_SECRET = originalSecret; }
});
test("consumption rolls back with failed account/profile creation and permits only one finalization", async () => {
    const f = fixture(); await f.service.send(email, session);
    const { registration_authorization: authorization } = await f.service.verify(email, session, f.code());
    await assert.rejects(f.db.sequelize.transaction(async tx => { await f.service.consume(email, session, authorization, tx); throw new Error("profile storage failed"); }), /profile storage failed/);
    assert.equal(f.row().status, "verified");
    const results = await Promise.allSettled([1, 2].map(() => f.db.sequelize.transaction(tx => f.service.consume(email, session, authorization, tx))));
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(f.row().status, "consumed");
    await rejectsCode(f.service.verify(email, session, f.code()), "OTP_CONSUMED");
    assert.equal((await f.service.status(email, session)).registration_authorization, undefined);
});
