const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcrypt");
const crypto = require("node:crypto");
const db = require("../models");
const rateLimits = require("../utils/rateLimitStore");
const emailWorker = require("../workers/emailQueueWorker");
const originalRateLimit = rateLimits.consumeRateLimit;
rateLimits.consumeRateLimit = async () => ({ allowed: true });
const auth = require("../controllers/authController");
rateLimits.consumeRateLimit = originalRateLimit;

const response = () => ({
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
});

test("password reset consumes expiring tokens and rolls back when the email queue fails", async () => {
    const originals = {
        transaction: db.sequelize.transaction,
        tokenFindOne: db.PasswordResetToken.findOne,
        tokenDestroy: db.PasswordResetToken.destroy,
        tokenCreate: db.PasswordResetToken.create,
        userFindOne: db.User.findOne,
        emailBulkCreate: db.EmailQueueJob.bulkCreate,
        emailFindOne: db.EmailQueueJob.findOne,
        emailUpdate: db.EmailQueueJob.update,
        fetch: global.fetch,
        environment: Object.fromEntries(["EMAIL_PROVIDER", "BREVO_API_KEY", "EMAIL_FROM", "EMAIL_FROM_NAME", "FRONTEND_URL"].map(key => [key, process.env[key]]))
    };
    let storedToken = { token: "stored-hash", user_id: 41, role: "alumni", expires_at: new Date(Date.now() + 60_000) };
    let currentUser = { id: 41, role: "alumni", email: "alumnus@example.invalid", password: "old-hash", update: async function(values) { Object.assign(this, values); } };
    const tokenDeletes = [];
    let transactionRolledBack = false;
    let transactionCommitted = false;
    const queuedJobs = [];
    const createdTokens = [];
    db.sequelize.transaction = async callback => {
        try {
            const result = await callback({ LOCK: { UPDATE: "UPDATE" } });
            transactionCommitted = true;
            return result;
        } catch (error) {
            transactionRolledBack = true;
            throw error;
        }
    };
    db.PasswordResetToken.findOne = async () => storedToken;
    db.PasswordResetToken.destroy = async options => {
        tokenDeletes.push(options.where);
        if (options.where.token) {
            if (!storedToken) return 0;
            storedToken = null;
            return 1;
        }
        return 0;
    };
    db.PasswordResetToken.create = async values => { createdTokens.push(values); return values; };
    db.User.findOne = async () => currentUser;
    db.EmailQueueJob.bulkCreate = async values => values.map(value => {
        const job = { id: queuedJobs.length + 1, status: "pending", attempts: 0, max_attempts: 5, scheduled_at: new Date(), ...value };
        queuedJobs.push(job);
        return job;
    });
    db.EmailQueueJob.findOne = async ({ where }) => queuedJobs.find(job => Object.entries(where).every(([key, value]) => job[key] === value)) || null;
    db.EmailQueueJob.update = async (values, { where }) => {
        const job = queuedJobs.find(item => Object.entries(where).every(([key, value]) => item[key] === value));
        if (!job) return [0];
        Object.assign(job, values);
        return [1];
    };

    try {
        Object.assign(process.env, {
            EMAIL_PROVIDER: "brevo",
            BREVO_API_KEY: "isolated-workflow-fixture-key",
            EMAIL_FROM: "sender@example.invalid",
            EMAIL_FROM_NAME: "DJEMC Test Portal",
            FRONTEND_URL: "https://portal.example.invalid"
        });
        let brevoRequest = null;
        global.fetch = async (url, options) => {
            assert.equal(url, "https://api.brevo.com/v3/smtp/email");
            assert.equal(options.headers["api-key"], "isolated-workflow-fixture-key");
            brevoRequest = JSON.parse(options.body);
            return Response.json({ messageId: "<reset-workflow-fixture@brevo.invalid>" }, { status: 201 });
        };
        const queued = response();
        await auth.forgotPassword({ body: { email: currentUser.email, role: "alumni" }, headers: {}, ip: "127.0.0.3" }, queued, error => { throw error; });
        assert.equal(queued.body.msg, "If an account exists, a reset link has been sent.");
        assert.equal(queuedJobs.length, 1);
        const resetMessage = queuedJobs[0].message;
        const resetLink = resetMessage.split("\n").find(line => line.includes("/reset-password?"));
        const resetUrl = resetLink.split("here: ").at(-1);
        const rawToken = new URL(resetUrl).searchParams.get("token");
        assert.equal(queuedJobs[0].to, "alumnus@example.invalid");
        assert.equal(createdTokens[0].token, crypto.createHash("sha256").update(rawToken).digest("hex"));
        assert.ok(createdTokens[0].expires_at > new Date());
        assert.match(resetUrl, /^https:\/\/portal\.example\.invalid\/reset-password\?/);
        assert.match(resetMessage, /expires in 15 minutes/);
        const workerJob = queuedJobs[0];
        Object.assign(workerJob, { status: "processing", attempts: 1, processing_started_at: new Date() });
        await emailWorker.processJob(workerJob);
        assert.equal(workerJob.status, "sent");
        assert.equal(brevoRequest.to[0].email, "alumnus@example.invalid");
        assert.match(brevoRequest.textContent, new RegExp(rawToken));

        tokenDeletes.length = 0;
        const res = response();
        // The controller hashes the presented token before lookup; stub lookup
        // to return the isolated disposable record above.
        await auth.resetPassword({ body: { token: "one-time-token", newPassword: "new-secret-password" }, headers: {}, ip: "127.0.0.1" }, res, error => { throw error; });
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.role, "alumni");
        assert.notEqual(currentUser.password, "new-secret-password");
        assert.equal(await bcrypt.compare("new-secret-password", currentUser.password), true);
        assert.equal(tokenDeletes.length, 2);
        assert.equal(transactionCommitted, true);
        assert.equal(storedToken, null);

        const reused = response();
        await auth.resetPassword({ body: { token: "one-time-token", newPassword: "another-password" }, headers: {}, ip: "127.0.0.1" }, reused, error => { throw error; });
        assert.equal(reused.statusCode, 400);
        assert.equal(await bcrypt.compare("new-secret-password", currentUser.password), true);

        storedToken = { token: "expired-hash", user_id: 41, role: "alumni", expires_at: new Date(Date.now() - 1000) };
        const expired = response();
        await auth.resetPassword({ body: { token: "expired-token", newPassword: "third-password" }, headers: {}, ip: "127.0.0.1" }, expired, error => { throw error; });
        assert.equal(expired.statusCode, 400);
        assert.equal(await bcrypt.compare("new-secret-password", currentUser.password), true);

        transactionRolledBack = false;
        transactionCommitted = false;
        storedToken = { token: "new-hash", user_id: 41, role: "alumni", expires_at: new Date(Date.now() + 60_000) };
        db.User.findOne = async ({ where }) => where.role === "alumni" ? currentUser : null;
        db.EmailQueueJob.bulkCreate = async () => { throw new Error("isolated email queue failure"); };
        db.PasswordResetToken.destroy = async () => 1;
        db.PasswordResetToken.create = async () => ({ id: 1 });
        let queueError = null;
        const forgot = response();
        await auth.forgotPassword({ body: { email: "alumnus@example.invalid", role: "alumni" }, headers: {}, ip: "127.0.0.2" }, forgot, error => { queueError = error; });
        assert.ok(queueError);
        assert.equal(forgot.body, null);
        assert.equal(transactionRolledBack, true);
        assert.equal(transactionCommitted, false);
    } finally {
        db.sequelize.transaction = originals.transaction;
        db.PasswordResetToken.findOne = originals.tokenFindOne;
        db.PasswordResetToken.destroy = originals.tokenDestroy;
        db.PasswordResetToken.create = originals.tokenCreate;
        db.User.findOne = originals.userFindOne;
        db.EmailQueueJob.bulkCreate = originals.emailBulkCreate;
        db.EmailQueueJob.findOne = originals.emailFindOne;
        db.EmailQueueJob.update = originals.emailUpdate;
        global.fetch = originals.fetch;
        for (const [key, value] of Object.entries(originals.environment)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    }
});
