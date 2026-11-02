const test = require("node:test");
const assert = require("node:assert/strict");
const { validateDetails } = require("../services/adminRegistration");
const db = require("../models");
const factory = require("../services/registrationOtp");
const validBody = () => ({ name: "Fixture admin", email: "admin.fixture@gmail.com", password: "fixture-password", admin_scope: "registrar", session_token: "b".repeat(64) });
const response = () => ({ statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
test.after(() => db.sequelize.close());

test("Admin details are validated with one function before OTP and again before account creation", () => {
    assert.deepEqual(validateDetails({ ...validBody(), name: "  Fixture admin  ", email: "ADMIN.FIXTURE@GMAIL.COM" }), {
        name: "Fixture admin", email: "admin.fixture@gmail.com", password: "fixture-password", scope: "registrar"
    });
    for (const extra of [{ name: " " }, { password: "short" }, { password: "é".repeat(37) }, { email: "invalid@example.com" }, { admin_scope: "root" }])
        assert.throws(() => validateDetails({ ...validBody(), ...extra }), error => error.status === 400);
});

test("Admin handlers reuse the registration OTP factory and reject invalid sends before generation", async () => {
    const env = { EMAIL_PROVIDER: "brevo", BREVO_API_KEY: "fixture-rest-key", EMAIL_FROM: "sender@fixture.test", EMAIL_FROM_NAME: "Fixture Portal", REGISTRATION_OTP_SECRET: "a".repeat(64), ADMIN_BOOTSTRAP_SECRET: "fixture-secret", DB_HOST: "127.0.0.1", DB_PORT: "1", DB_NAME: "fixture", DB_USER: "fixture" };
    const saved = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
    const original = { create: factory.createRegistrationOtp, findAll: db.User.findAll };
    const controllerPath = require.resolve("../controllers/adminRegistrationController");
    const previous = require.cache[controllerPath];
    const calls = [];
    Object.assign(process.env, env);
    try {
        factory.createRegistrationOtp = options => {
            assert.equal(options.purpose, "admin-registration"); assert.equal(typeof options.sendEmail, "function"); assert.equal(typeof options.deliveryStatus, "function");
            return { send: async (...args) => { calls.push(args); return { status: "sent", email_status: "pending", verified: false }; },
                verify: async (...args) => { calls.push(args); return { status: "verified", verified: true }; } };
        };
        db.User.findAll = async () => [];
        delete require.cache[controllerPath];
        const controller = require(controllerPath);
        for (const operation of ["send", "resend"]) {
            const invalid = response();
            await controller[operation]({ body: { ...validBody(), name: "" } }, invalid, error => { throw error; });
            assert.equal(invalid.statusCode, 400); assert.equal(invalid.body.code, "INVALID_ADMIN_REGISTRATION"); assert.equal(calls.length, 0);
        }
        const accepted = response();
        await controller.send({ body: validBody() }, accepted, error => { throw error; });
        assert.deepEqual(calls.shift(), [validBody().email, validBody().session_token, undefined]);
        assert.equal(accepted.body.email_status, "pending"); assert.equal(accepted.body.verified, false);
        await controller.resend({ body: validBody() }, response(), error => { throw error; });
        assert.deepEqual(calls.shift(), [validBody().email, validBody().session_token, { resend: true }]);
        await controller.verify({ body: { email: validBody().email, session_token: validBody().session_token, admin_scope: "registrar", otp: "123456" } }, response(), error => { throw error; });
        assert.deepEqual(calls.shift(), [validBody().email, validBody().session_token, "123456"]);
    } finally {
        factory.createRegistrationOtp = original.create; db.User.findAll = original.findAll;
        if (previous) require.cache[controllerPath] = previous; else delete require.cache[controllerPath];
        for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    }
});
