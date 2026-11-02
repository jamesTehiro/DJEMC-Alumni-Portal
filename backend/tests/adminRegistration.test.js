const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { createRegistrationOtp, OTP_TTL, COOLDOWN } = require("../services/registrationOtp");
const { createAdminRegistration, availability, LIMIT_MESSAGE } = require("../services/adminRegistration");
const { createAdminOtpQueue, isActiveAdminOtpJob, jobKey } = require("../services/adminOtpQueue");
const { emailKey } = require("../utils/registrationEmail");
process.env.REGISTRATION_OTP_SECRET = "test-admin-otp-secret-with-at-least-thirty-two-bytes";
const email = "fixture.admin+setup@gmail.com", session = "b".repeat(64);
const rejectCode = (promise, code) => assert.rejects(promise, error => error.code === code);

function fixture() {
    let time = 1800000000123, sequence = 123456, users = [], rows = new Map(), jobs = [], pending = Promise.resolve(), queueFailure = false;
    const txOptions = [];
    const attach = row => Object.defineProperty(row, "update", { enumerable: false, value: async values => Object.assign(row, values) });
    const db = {
        Sequelize: { where: (_expression, value) => ({ canonical: value }), literal: value => value },
        User: {
            findAll: async options => { assert.equal(options.where.role, "admin"); return users.filter(user => user.role === "admin"); },
            findOne: async ({ where }) => users.find(user => emailKey(user.email) === where.canonical),
            create: async values => {
                if (users.some(user => emailKey(user.email) === emailKey(values.email) || user.role === "admin" && user.admin_scope === values.admin_scope))
                    throw Object.assign(new Error("Unique constraint"), { name: "SequelizeUniqueConstraintError" });
                const user = { ...values, id: users.length + 1 }; users.push(user); return user;
            }
        },
        RegistrationEmailVerification: {
            findByPk: async key => rows.get(key),
            update: async (values, { where }) => {
                const row = rows.get(where.email_key);
                if (!row || Object.entries(where).some(([key, value]) => row[key] !== value)) return [0];
                await row.update(values); return [1];
            }
        },
        EmailQueueJob: { findOne: async ({ where }) => jobs.find(job => job.dedupe_key === where.dedupe_key) },
        sequelize: {
            query: async (_sql, { replacements: [key, to, hash] }) => {
                if (!rows.has(key)) rows.set(key, attach({ email_key: key, email: to, session_hash: hash, status: "failed", sent_at: new Date(0), resend_history: [], failed_attempts: 0, consumed_at: null }));
            },
            transaction: async (options, callback) => {
                if (typeof options === "function") { callback = options; options = {}; }
                txOptions.push(options);
                const previous = pending; let release;
                pending = new Promise(resolve => { release = resolve; }); await previous;
                const before = { users: structuredClone(users), rows: structuredClone([...rows]), jobs: structuredClone(jobs) };
                try { return await callback({ LOCK: { UPDATE: "UPDATE" } }); }
                catch (error) { users = before.users; rows = new Map(before.rows.map(([key, row]) => [key, attach(row)])); jobs = before.jobs; throw error; }
                finally { release(); }
            }
        }
    };
    const transport = createAdminOtpQueue({ db, enqueueEmails: async (messages, options) => {
        assert.ok(options.transaction, "Queue errors propagate through a transaction");
        if (queueFailure) throw new Error("Mock queue unavailable");
        for (const message of messages) jobs.push({ ...message, id: jobs.length + 1, status: "pending" });
    } });
    const otp = createRegistrationOtp({ db, ...transport, purpose: "admin-registration", now: () => time, randomInt: () => sequence++ });
    const admin = createAdminRegistration({ db, otp, hash: password => bcrypt.hash(password, 4) });
    const body = (scope = "registrar") => ({ name: "Fixture admin", email, password: "fixture-password", admin_scope: scope, session_token: session });
    return { db, otp, admin, body, txOptions, users: () => users, row: () => rows.get(emailKey(email)), jobs: () => jobs,
        seed: values => { users = values; }, advance: ms => { time += ms; }, now: () => time,
        failQueue: () => { queueFailure = true; }, code: () => jobs.at(-1).message.match(/^\d{6}$/m)[0],
        async proof() { await otp.send(email, session); jobs.at(-1).status = "sent"; return otp.verify(email, session, this.code()); }
    };
}

test("successful admin creation requires provider-accepted OTP and atomically consumes proof", async () => {
    const f = fixture(); const proof = await f.proof();
    const user = await f.admin.create({ ...f.body(), registration_authorization: proof.registration_authorization });
    assert.equal(user.role, "admin"); assert.equal(user.admin_scope, "registrar"); assert.equal(user.account_status, "verified");
    assert.ok(user.email_verified_at); assert.ok(await bcrypt.compare("fixture-password", user.password));
    assert.equal(f.row().status, "consumed"); assert.equal(f.row().consumed_by_user_id, user.id);
    assert.ok(f.txOptions.some(options => options.isolationLevel === "SERIALIZABLE"));
});
test("admin cannot be created without Gmail OTP or with a client-supplied verified status", async () => {
    const f = fixture();
    await rejectCode(f.admin.create({ ...f.body(), account_status: "verified", email_verified_at: new Date() }), "GMAIL_VERIFICATION_REQUIRED");
    assert.equal(f.users().length, 0);
});
test("pending and verified admins occupy their scope; ordinary accounts do not count", async () => {
    for (const account_status of ["verified", "pending"]) {
        const f = fixture(); f.seed([{ role: "admin", admin_scope: "registrar", account_status }]);
        await rejectCode(f.admin.create(f.body()), "ADMIN_SCOPE_OCCUPIED");
    }
    const f = fixture(); f.seed(Array.from({ length: 20 }, (_, index) => ({ role: index % 2 ? "alumni" : "employer", email: `ordinary${index}@gmail.com` })));
    assert.equal((await f.admin.status()).adminCount, 0);
    const proof = await f.proof(); await f.admin.create({ ...f.body(), registration_authorization: proof.registration_authorization });
    assert.equal(f.users().filter(user => user.role === "admin").length, 1);
});
test("full total including legacy/pending scopes rejects a fourth direct creation request", async () => {
    const f = fixture(); f.seed(["legacy", "alumni", "employer"].map(admin_scope => ({ role: "admin", admin_scope, account_status: "pending" })));
    await rejectCode(f.admin.create(f.body()), "ADMIN_LIMIT_REACHED");
    assert.deepEqual((await f.admin.status()).availableScopes, []);
    assert.equal((await f.admin.status()).msg, LIMIT_MESSAGE);
});
test("duplicate Gmail aliases across roles and pending accounts are rejected", async () => {
    for (const role of ["alumni", "employer", "admin"]) {
        const f = fixture(); f.seed([{ role, admin_scope: "employer", email: "fixtureadmin@gmail.com", account_status: "pending" }]);
        await rejectCode(f.admin.create(f.body()), "EMAIL_REGISTERED");
        await rejectCode(f.otp.send(email, session), "EMAIL_REGISTERED");
        assert.equal(f.jobs().length, 0);
    }
});
test("simultaneous requests for one scope produce one account and one consumed grant", async () => {
    const f = fixture(); const proof = await f.proof();
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => f.admin.create({ ...f.body(), registration_authorization: proof.registration_authorization })));
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(f.users().length, 1);
    assert.ok(results.filter(result => result.status === "rejected").every(result => result.reason.code === "ADMIN_SCOPE_OCCUPIED"));
});
test("concurrent different scopes cannot exceed three when legacy admins exist", async () => {
    const f = fixture(); f.seed(["legacy", "registrar"].map(admin_scope => ({ role: "admin", admin_scope, email: `${admin_scope}@example.invalid` })));
    const proof = await f.proof();
    const results = await Promise.allSettled(["alumni", "employer"].map(scope => f.admin.create({ ...f.body(scope), registration_authorization: proof.registration_authorization })));
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(results.find(result => result.status === "rejected").reason.code, "ADMIN_LIMIT_REACHED");
    assert.equal(f.users().length, 3);
});
test("database deadlocks retry boundedly; unique conflicts remain readable", async () => {
    const f = fixture(); const transaction = f.db.sequelize.transaction;
    let attempts = 0;
    f.db.sequelize.transaction = async (...args) => { attempts++; if (attempts < 3) throw { original: { code: "ER_LOCK_DEADLOCK" } }; return transaction(...args); };
    await rejectCode(f.admin.create(f.body()), "GMAIL_VERIFICATION_REQUIRED"); assert.equal(attempts, 3);
    f.db.sequelize.transaction = async () => { throw { original: { code: "ER_LOCK_WAIT_TIMEOUT" } }; };
    await rejectCode(f.admin.create(f.body()), "ADMIN_REGISTRATION_BUSY");
    f.db.sequelize.transaction = async () => { throw { name: "SequelizeUniqueConstraintError" }; };
    await rejectCode(f.admin.create(f.body()), "ADMIN_REGISTRATION_CONFLICT");
});
test("invalid email, scope and password are validation failures without writes", async () => {
    const f = fixture();
    for (const extra of [{ email: "other@example.com" }, { admin_scope: "root" }, { password: "short" }, { password: "x".repeat(73) }, { name: [] }])
        await assert.rejects(f.admin.create({ ...f.body(), ...extra }), error => error.status === 400);
    assert.equal(f.users().length, 0);
});
test("queued delivery is not reported as sent; verification waits for provider acceptance", async () => {
    const f = fixture(); const sent = await f.otp.send(email, session);
    assert.equal(sent.email_status, "pending"); assert.equal(sent.verified, false);
    assert.equal((await f.otp.send(email, session)).email_status, "pending"); assert.equal(f.jobs().length, 1);
    await rejectCode(f.otp.verify(email, session, f.code()), "OTP_QUEUED"); assert.equal(f.row().failed_attempts, 0);
    f.jobs()[0].status = "sent";
    const verified = await f.otp.verify(email, session, f.code());
    assert.equal(verified.verified, true);
    const claims = jwt.verify(verified.registration_authorization, process.env.REGISTRATION_OTP_SECRET, { audience: "admin-registration", issuer: "alumni-portal", clockTimestamp: Math.floor(f.now() / 1000) });
    assert.equal(claims.purpose, "admin-registration"); assert.equal(f.row().otp_hash, null);
});
test("queue insertion failure and failed provider delivery cannot grant verification", async () => {
    const f = fixture(); f.failQueue(); await rejectCode(f.otp.send(email, session), "OTP_DELIVERY_FAILED");
    assert.equal(f.jobs().length, 0); assert.equal(f.row().status, "failed"); assert.equal(f.row().otp_hash, null);
    const g = fixture(); await g.otp.send(email, session); g.jobs()[0].status = "failed";
    assert.equal((await g.otp.status(email, session)).email_status, "failed");
    await rejectCode(g.otp.verify(email, session, g.code()), "OTP_DELIVERY_FAILED");
});
test("wrong OTP attempts, expiry, cooldown and resend restrictions remain enforced for admin", async () => {
    const f = fixture(); await f.otp.send(email, session); f.jobs()[0].status = "sent";
    await rejectCode(f.otp.send(email, session, { resend: true }), "OTP_COOLDOWN");
    for (let index = 0; index < 5; index++) await rejectCode(f.otp.verify(email, session, "999999"), index === 4 ? "OTP_ATTEMPTS" : "OTP_INCORRECT");
    await rejectCode(f.otp.verify(email, session, f.code()), "OTP_ATTEMPTS");
    f.advance(COOLDOWN); await f.otp.send(email, session, { resend: true }); f.jobs().at(-1).status = "sent";
    f.advance(OTP_TTL); await rejectCode(f.otp.verify(email, session, f.code()), "OTP_EXPIRED");
    for (let index = 0; index < 2; index++) { await f.otp.send(email, session, { resend: true }); f.advance(COOLDOWN); }
    await rejectCode(f.otp.send(email, session, { resend: true }), "OTP_SEND_LIMIT");
});
test("worker permits current admin jobs, rejects expired/replaced codes and ignores normal mail", async () => {
    const f = fixture(); await f.otp.send(email, session); const job = f.jobs()[0];
    assert.equal(await isActiveAdminOtpJob(f.db, job, f.now()), true);
    assert.ok(job.dedupe_key.length < 191); assert.equal(job.dedupe_key.includes(f.code()), false);
    assert.equal(await isActiveAdminOtpJob(f.db, job, f.now() + OTP_TTL), false);
    f.advance(COOLDOWN); await f.otp.send(email, session, { resend: true });
    assert.equal(await isActiveAdminOtpJob(f.db, job, f.now()), false);
    assert.equal(await isActiveAdminOtpJob(f.db, f.jobs()[1], f.now()), true);
    assert.equal(await isActiveAdminOtpJob({}, { dedupe_key: "ordinary-notification" }), true);
    assert.equal(jobKey(f.row()), f.jobs()[1].dedupe_key);
});
test("Alumni verification sessions and grants cannot authorize admin creation", async () => {
    const f = fixture();
    const alumni = createRegistrationOtp({ db: f.db, now: f.now, randomInt: () => 123456, sendEmail: async () => {} });
    await alumni.send(email, session); const proof = await alumni.verify(email, session, "123456");
    await rejectCode(f.admin.create({ ...f.body(), registration_authorization: proof.registration_authorization }), "GMAIL_VERIFICATION_REQUIRED");
    await rejectCode(f.otp.status(email, session), "INVALID_SESSION");
    assert.equal(f.row().status, "verified"); assert.equal(f.users().length, 0);
});
test("proof is rolled back if account insertion fails and can be retried", async () => {
    const f = fixture(); const proof = await f.proof(); const create = f.db.User.create;
    f.db.User.create = async () => { throw new Error("Mock insert failure"); };
    await assert.rejects(f.admin.create({ ...f.body(), registration_authorization: proof.registration_authorization }));
    assert.equal(f.row().status, "verified"); assert.equal(f.row().consumed_at, null);
    f.db.User.create = create;
    await f.admin.create({ ...f.body(), registration_authorization: proof.registration_authorization });
    assert.equal(f.users().length, 1);
});
test("availability never exposes account identifiers or email addresses", () => {
    const result = availability([{ role: "admin", admin_scope: "alumni", email: "private@example.invalid", id: 42 }]);
    assert.equal(JSON.stringify(result).includes("private"), false); assert.equal(result.adminCount, 1);
    assert.deepEqual(result.availableScopes, ["registrar", "employer"]);
});
