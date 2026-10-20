const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcrypt");

process.env.JWT_SECRET = "test-only-jwt-secret";

const db = require("../models");
const authController = require("../controllers/authController");
const { otp } = require("../controllers/registrationOtpController");
const roleMiddleware = require("../middleware/roleMiddleware");

const createRes = () => ({
    statusCode: 200,
    body: null,
    status(code) {
        this.statusCode = code;
        return this;
    },
    json(payload) {
        this.body = payload;
        return this;
    }
});

test("login returns the token and role from the matched account", async () => {
    const originalFindOne = db.User.findOne;
    const passwordHash = await bcrypt.hash("valid-password", 4);
    db.User.findOne = async () => ({
        id: 8181,
        name: "Test Alumni",
        email: "test-alumni@example.invalid",
        password: passwordHash,
        role: "alumni",
        account_status: "verified"
    });

    try {
        const res = createRes();
        await authController.login({ body: { email: "test-alumni@example.invalid", password: "valid-password" } }, res, (err) => { throw err; });
        assert.equal(typeof res.body.token, "string");
        assert.equal(res.body.user.role, "alumni");
        assert.equal(res.body.user.id, 8181);
        assert.equal(Object.hasOwn(res.body.user, "password"), false);
    } finally {
        db.User.findOne = originalFindOne;
    }
});

test("login rejects an invalid password without returning a token", async () => {
    const originalFindOne = db.User.findOne;
    const passwordHash = await bcrypt.hash("different-password", 4);
    db.User.findOne = async () => ({
        id: 8182,
        password: passwordHash,
        role: "alumni",
        account_status: "verified"
    });

    try {
        const res = createRes();
        await authController.login({ body: { email: "test@example.invalid", password: "invalid-password" } }, res, (err) => { throw err; });
        assert.equal(res.statusCode, 400);
        assert.equal(res.body.token, undefined);
    } finally {
        db.User.findOne = originalFindOne;
    }
});

test("registration responds successfully only after its transaction completes", async () => {
    const originals = {
        userFindOne: db.User.findOne,
        userCreate: db.User.create,
        alumniFindOrCreate: db.AlumniProfile.findOrCreate,
        transaction: db.sequelize.transaction,
        consume: otp.consume
    };
    let transactionCompleted = false;
    otp.consume = async () => ({ verified_at: new Date(), update: async () => {} });
    db.User.findOne = async () => null;
    db.User.create = async () => ({
        id: 8183,
        name: "Test Registration",
        email: "registration-test@example.invalid",
        role: "alumni",
        account_status: "pending"
    });
    db.AlumniProfile.findOrCreate = async () => [{ user_id: 8183 }, true];
    db.sequelize.transaction = async (callback) => {
        const result = await callback({});
        transactionCompleted = true;
        return result;
    };

    try {
        const res = createRes();
        await authController.register({
            body: { name: "Test Registration", email: "registration.test@gmail.com", password: "test-password", role: "alumni", graduationYear: "2023" },
            files: {}
        }, res, (err) => { throw err; });
        assert.equal(transactionCompleted, true);
        assert.equal(res.statusCode, 201);
        assert.equal(res.body.user.role, "alumni");
    } finally {
        db.User.findOne = originals.userFindOne;
        db.User.create = originals.userCreate;
        db.AlumniProfile.findOrCreate = originals.alumniFindOrCreate;
        db.sequelize.transaction = originals.transaction;
        otp.consume = originals.consume;
    }
});

test("registration database insert failure returns an error and never reports success", async () => {
    const originals = {
        userFindOne: db.User.findOne,
        userCreate: db.User.create,
        transaction: db.sequelize.transaction,
        consume: otp.consume
    };
    let transactionCompleted = false;
    otp.consume = async () => ({ verified_at: new Date(), update: async () => {} });
    db.User.findOne = async () => null;
    db.User.create = async () => {
        const err = new Error("database insert failed");
        err.name = "SequelizeDatabaseError";
        err.original = { code: "ER_NO_SUCH_TABLE" };
        throw err;
    };
    db.sequelize.transaction = async (callback) => {
        const result = await callback({});
        transactionCompleted = true;
        return result;
    };

    try {
        const res = createRes();
        let forwardedError;
        await authController.register({
            body: { name: "Test Registration", email: "failure.test@gmail.com", password: "test-password", role: "alumni", graduationYear: "2023" },
            files: {}
        }, res, (err) => { forwardedError = err; });
        assert.equal(transactionCompleted, false);
        assert.equal(res.body, null);
        assert.equal(forwardedError.status, 503);
        assert.match(forwardedError.publicMessage, /temporarily unavailable/i);
    } finally {
        db.User.findOne = originals.userFindOne;
        db.User.create = originals.userCreate;
        db.sequelize.transaction = originals.transaction;
        otp.consume = originals.consume;
    }
});

test("role middleware keeps employer access scoped to employer accounts", async () => {
    const middleware = roleMiddleware(["employer"]);
    const denied = createRes();
    let allowed = false;

    middleware({ user: { id: 8184, role: "alumni" } }, denied, () => { allowed = true; });
    assert.equal(denied.statusCode, 403);
    assert.equal(allowed, false);

    const accepted = createRes();
    middleware({ user: { id: 8185, role: "employer" } }, accepted, () => { allowed = true; });
    assert.equal(allowed, true);
});
