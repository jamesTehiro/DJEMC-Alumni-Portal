const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs/promises");
const Sequelize = require("sequelize");
const bcrypt = require("bcrypt");
const migration = require("../migrations/20261019-add-registration-gmail-otp");
const { createRegistrationOtp } = require("../services/registrationOtp");

// This opt-in creates NEW local fixture databases only. No cleanup SQL drops,
// truncates or deletes any table/database. Never point this harness at Aiven.
test("real local database: additive migration, uniqueness, concurrent registration and Registrar workflow", { skip: process.env.RUN_OTP_DATABASE_TESTS !== "true" }, async t => {
    process.env.JWT_SECRET = "isolated-otp-login-test-secret";
    process.env.REGISTRATION_OTP_SECRET = "isolated-otp-test-secret-at-least-32-bytes";
    const db = require("../models");
    const adminConnection = db.sequelize;
    const host = String(adminConnection.config.host).toLowerCase();
    assert.ok(["localhost", "127.0.0.1", "::1", os.hostname().toLowerCase()].includes(host), "Integration harness accepts only a confirmed local server.");
    assert.notEqual(process.env.NODE_ENV, "production");
    const name = `djemc_otp_${process.pid}_${Date.now()}_test`;
    const [existing] = await adminConnection.query("SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?", { replacements: [name] });
    assert.equal(existing.length, 0, "Refuse to reuse or recreate any existing database.");
    await adminConnection.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci`);
    const isolated = new Sequelize.Sequelize(name, adminConnection.config.username, adminConnection.config.password, { host: adminConnection.config.host, port: adminConnection.config.port,
        dialect: "mysql", logging: false, pool: { max: 5, min: 0, idle: 1000 } });
    const originals = { sequelize: db.sequelize };
    const models = ["User", "AlumniProfile", "AlumniRecord", "EmployerProfile", "Notification", "EmailQueueJob", "AuditLog"];
    const restoreOtp = {};
    let otp;
    try {
        db.sequelize = isolated;
        for (const model of models) { originals[model] = db[model]; db[model] = require(`../models/${model}`)(isolated, Sequelize); }
        originals.RegistrationEmailVerification = db.RegistrationEmailVerification;
        db.RegistrationEmailVerification = require("../models/RegistrationEmailVerification")(isolated, Sequelize);
        db.User.hasOne(db.AlumniProfile, { foreignKey: "user_id" });
        const qi = isolated.getQueryInterface();
        for (const model of models) {
            const attributes = { ...db[model].rawAttributes };
            if (model === "User") delete attributes.email_verified_at;
            await qi.createTable(db[model].getTableName(), attributes, { engine: "InnoDB" });
        }
        const password = "test-only-password";
        const passwordHash = await bcrypt.hash(password, 4);
        const timestamp = new Date("2026-01-01T00:00:00Z");
        await qi.bulkInsert("users", ["alumni", "employer", "admin"].map((role, index) => ({ id: index + 1, name: `Legacy ${role}`, email: `legacy-${role}@example.invalid`, password: passwordHash,
            role, account_status: "verified", admin_scope: role === "admin" ? "registrar" : null, createdAt: timestamp, updatedAt: timestamp })));
        await db.AlumniProfile.create({ user_id: 1, course: "Legacy program", graduation_year: 2020, proof_document_path: "/uploads/documents/legacy-proof.pdf", current_company: "Preserved employer" });
        await db.AlumniRecord.create({ full_name: "Legacy official record", student_id: "LEGACY-001", course: "Legacy program", batch_year: 2020 });
        await db.EmployerProfile.create({ user_id: 2, organization_name: "Legacy organization" });
        const legacyUsers = await isolated.query("SELECT * FROM users ORDER BY id", { type: Sequelize.QueryTypes.SELECT });
        const beforeProfiles = await db.AlumniProfile.findAll({ raw: true });
        const beforeRecords = await db.AlumniRecord.findAll({ raw: true });
        const beforeEmployers = await db.EmployerProfile.findAll({ raw: true });
        const ddl = [];
        const originalQuery = isolated.query.bind(isolated);
        isolated.query = (sql, options) => {
            if (typeof sql === "string" && /^(ALTER|CREATE)\b/i.test(sql)) ddl.push(sql);
            return originalQuery(sql, options);
        };
        await t.test("migration executes additively, preserves original values and is idempotent", async () => {
            const before = await migration.inspect(qi, Sequelize);
            assert.equal(before.duplicateGroups, 0); assert.equal(before.verifiedAtColumnPresent, false);
            await migration.up(qi, Sequelize);
            const after = await migration.inspect(qi, Sequelize);
            assert.equal(after.verificationTablePresent, true); assert.equal(after.uniqueIndexPresent, true); assert.equal(after.verifiedAtColumnPresent, true);
            assert.deepEqual(await isolated.query("SELECT id,name,email,password,role,admin_scope,admin_department,admin_avatar_url,account_status,alumni_record_id,createdAt,updatedAt FROM users ORDER BY id", { type: Sequelize.QueryTypes.SELECT }), legacyUsers);
            assert.deepEqual(await db.AlumniProfile.findAll({ raw: true }), beforeProfiles);
            assert.deepEqual(await db.AlumniRecord.findAll({ raw: true }), beforeRecords);
            assert.deepEqual(await db.EmployerProfile.findAll({ raw: true }), beforeEmployers);
            const count = ddl.length; await migration.up(qi, Sequelize); assert.equal(ddl.length, count);
            assert.ok((await db.User.findAll()).every(user => user.email_verified_at === null));
        });
        const emails = [];
        const service = createRegistrationOtp({ db, sendEmail: async (to, subject, text) => { emails.push({ to, subject, text }); } });
        otp = require("../controllers/registrationOtpController").otp;
        for (const method of Object.keys(service)) { restoreOtp[method] = otp[method]; otp[method] = service[method]; }
        const auth = require("../controllers/authController");
        const registrar = require("../controllers/registrarController");
        const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
        const register = async (email, session_token, registration_authorization, files = {}) => {
            const res = response(); let error;
            await auth.register({ body: { name: "Isolated new alumni", email, password, role: "alumni", course: "BSIT", graduationYear: "2023", session_token, registration_authorization }, files }, res, value => { error = value; });
            return { res, error };
        };
        const email = "isolated.new+portal@gmail.com", session = "a".repeat(64);
        await t.test("real row locks deduplicate initial requests and reject direct API bypass", async () => {
            const bypass = await register(email, session, "isVerified:true");
            assert.equal(bypass.error.status, 403); assert.equal(await db.User.count(), 3);
            await Promise.all(Array.from({ length: 5 }, () => service.send(email, session)));
            assert.equal(emails.length, 1);
        });
        const code = emails.at(-1).text.match(/^\d{6}$/m)[0];
        const verified = await service.verify(email, session, code);
        await t.test("verified authorization survives a fresh database read and is consumed with account/profile", async () => {
            const restored = await service.status(email, session);
            assert.equal(restored.registration_authorization, verified.registration_authorization);
            const originalProfileCreate = db.AlumniProfile.findOrCreate;
            try {
                db.AlumniProfile.findOrCreate = async () => { throw new Error("isolated profile failure"); };
                const failed = await register(email, session, restored.registration_authorization);
                assert.ok(failed.error); assert.equal(await db.User.count(), 3);
                assert.equal((await db.RegistrationEmailVerification.findByPk("isolatednew@gmail.com")).status, "verified");
            } finally { db.AlumniProfile.findOrCreate = originalProfileCreate; }
            const requests = await Promise.all([1, 2].map(() => register(email, session, restored.registration_authorization, { proof_document: [{ filename: "isolated-proof.pdf" }] })));
            assert.equal(requests.filter(result => result.res.statusCode === 201).length, 1);
            const created = await db.User.findOne({ where: { email } });
            assert.equal(created.account_status, "pending"); assert.ok(created.email_verified_at);
            assert.equal((await db.AlumniProfile.findOne({ where: { user_id: created.id } })).proof_document_path, "/uploads/documents/isolated-proof.pdf");
            const challenge = await db.RegistrationEmailVerification.findByPk("isolatednew@gmail.com");
            assert.equal(challenge.status, "consumed"); assert.equal(challenge.consumed_by_user_id, created.id);
        });
        await t.test("unique database key prevents Gmail aliases across roles and pending accounts", async () => {
            await assert.rejects(db.User.create({ name: "Duplicate fixture", email: "I.S.O.L.A.T.E.D.N.E.W@gmail.com", role: "employer", password: passwordHash }), error => error.name === "SequelizeUniqueConstraintError");
            await assert.rejects(service.send(email, "b".repeat(64)), error => error.code === "EMAIL_REGISTERED");
            assert.equal(await db.User.count(), 4);
        });
        await t.test("real database commits five concurrent incorrect attempts and the rolling resend budget", async () => {
            let clock = Date.now();
            let lastCode;
            const timed = createRegistrationOtp({ db, now: () => clock, sendEmail: async (_to, _subject, text) => { lastCode = text.match(/^\d{6}$/m)[0]; } });
            const address = "isolated.attempts@gmail.com", token = "d".repeat(64);
            await timed.send(address, token);
            const incorrect = lastCode === "000000" ? "999999" : "000000";
            await Promise.allSettled(Array.from({ length: 8 }, () => timed.verify(address, token, incorrect)));
            assert.equal((await db.RegistrationEmailVerification.findByPk("isolatedattempts@gmail.com")).failed_attempts, 5);
            await assert.rejects(timed.verify(address, token, lastCode), error => error.code === "OTP_ATTEMPTS");
            await assert.rejects(timed.send(address, token, { resend: true }), error => error.code === "OTP_COOLDOWN");
            for (let i = 0; i < 3; i++) { clock += 60000; await timed.send(address, token, { resend: true }); }
            clock += 60000;
            await assert.rejects(timed.send(address, "e".repeat(64)), error => error.code === "OTP_SEND_LIMIT");
            const storedHistory = (await db.RegistrationEmailVerification.findByPk("isolatedattempts@gmail.com")).resend_history;
            assert.equal((typeof storedHistory === "string" ? JSON.parse(storedHistory) : storedHistory).length, 3);
            assert.equal(await db.User.count(), 4);
        });
        await t.test("existing approved accounts log in without OTP and pending alumni are denied", async () => {
            for (const role of ["alumni", "employer", "admin"]) {
                const res = response(); await auth.login({ body: { email: `legacy-${role}@example.invalid`, password } }, res, error => { throw error; });
                assert.equal(res.statusCode, 200); assert.equal(typeof res.body.token, "string");
            }
            const pending = response(); await auth.login({ body: { email, password } }, pending, error => { throw error; });
            assert.equal(pending.statusCode, 403);
        });
        await t.test("Registrar matching, approval/rejection, queued notifications and safe resubmission retain history", async () => {
            const user = await db.User.findOne({ where: { email } });
            const record = await db.AlumniRecord.create({ full_name: user.name, student_id: "ISOLATED-002", course: "BSIT", batch_year: 2023 });
            const req = { params: { id: user.id }, body: { alumni_record_id: record.id }, user: { id: 3, role: "admin" }, ip: "127.0.0.1" };
            const approved = response(); await registrar.approveAlumniUser(req, approved);
            assert.equal(approved.statusCode, 200); await user.reload(); assert.equal(user.account_status, "verified"); assert.equal(user.alumni_record_id, record.id);
            const rejected = response(); await registrar.rejectAlumniUser(req, rejected);
            assert.equal(rejected.statusCode, 200); await user.reload(); assert.equal(user.account_status, "rejected");
            assert.equal(await db.User.count(), 4); assert.ok(await db.AlumniProfile.findOne({ where: { user_id: user.id } }));
            const notifications = await db.EmailQueueJob.findAll({ where: { to: email } });
            assert.deepEqual(notifications.map(row => row.subject).sort(), ["DJEMC Alumni Account Verified", "DJEMC Alumni Registration Not Approved"].sort());
            await assert.rejects(service.send(email, "c".repeat(64)), /Registrar Officer/);
            const login = response(); await auth.login({ body: { email, password } }, login, error => { throw error; }); assert.equal(login.statusCode, 403);
            const reconsidered = response(); await registrar.approveAlumniUser(req, reconsidered); assert.equal(reconsidered.statusCode, 200);
            assert.equal(await db.User.count(), 4);
        });
        const [version] = await isolated.query("SELECT VERSION() AS version", { type: Sequelize.QueryTypes.SELECT });
        const report = { database: name, localOnly: true, version: version.version, productionTouched: false, remoteAivenStagingTested: false, ddl,
            note: "New local fixture database retained. No destructive cleanup SQL or real emails were used." };
        await fs.mkdir(path.resolve(__dirname, "../../tmp"), { recursive: true });
        await fs.writeFile(path.resolve(__dirname, "../../tmp/registration-otp-local-db-test.json"), JSON.stringify(report, null, 2));
        console.log("OTP local integration evidence:", JSON.stringify({ database: name, version: version.version, remoteAivenStagingTested: false }));
    } finally {
        if (otp) Object.assign(otp, restoreOtp);
        Object.assign(db, originals);
        await isolated.close();
        await adminConnection.close();
    }
});
