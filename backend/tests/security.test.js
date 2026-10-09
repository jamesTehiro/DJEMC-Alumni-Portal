const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const db = require("../models");
const bootstrapGuard = require("../middleware/bootstrapGuard");
const authController = require("../controllers/authController");
const fileController = require("../controllers/fileController");
const applicationController = require("../controllers/applicationController");
const adminScopeMiddleware = require("../middleware/adminScopeMiddleware");
const registrarController = require("../controllers/registrarController");
const { encrypt, decrypt } = require("../utils/fieldEncryption");

test.after(async () => {
    await db.sequelize.close();
});

const createRes = () => {
    const res = {
        statusCode: 200,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.body = payload;
            return this;
        },
        sendFile(filePath) {
            this.filePath = filePath;
            return this;
        }
    };
    return res;
};

test("bootstrapGuard blocks invalid bootstrap secret", async () => {
    process.env.ADMIN_BOOTSTRAP_SECRET = "expected-secret";
    const originalFindAll = db.User.findAll;
    db.User.findAll = async () => [];

    const req = {
        method: "POST",
        originalUrl: "/api/auth/admin-setup",
        headers: {},
        body: {},
        query: {},
        ip: "127.0.0.1"
    };
    const res = createRes();
    let nextCalled = false;

    await bootstrapGuard(req, res, () => {
        nextCalled = true;
    });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.msg, "Invalid bootstrap secret.");
    db.User.findAll = originalFindAll;
});

test("bootstrapGuard allows setup status check when all admin scopes are already configured", async () => {
    process.env.ADMIN_BOOTSTRAP_SECRET = "expected-secret";
    const originalFindAll = db.User.findAll;
    db.User.findAll = async () => [
        { admin_scope: "registrar" },
        { admin_scope: "employer" },
        { admin_scope: "alumni" }
    ];

    const req = {
        method: "GET",
        originalUrl: "/api/auth/admin-setup-status",
        headers: {},
        body: {},
        query: {},
        ip: "127.0.0.1"
    };
    const res = createRes();
    let nextCalled = false;

    await bootstrapGuard(req, res, () => {
        nextCalled = true;
    });

    assert.equal(nextCalled, true);
    db.User.findAll = originalFindAll;
});

test("auth register rejects incomplete payload before creation", async () => {
    const req = { body: { email: "", password: "", role: "" }, files: {} };
    const res = createRes();
    let nextCalled = false;

    await authController.register(req, res, () => {
        nextCalled = true;
    });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.msg, /required/i);
});

test("forgot password ignores admin role and returns a generic response", async () => {
    const req = {
        body: { email: "admin@example.com", role: "admin" },
        headers: {},
        ip: "127.0.0.10"
    };
    const res = createRes();

    await authController.forgotPassword(req, res, () => {
        throw new Error("next should not be called");
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.msg, "If an account exists, a reset link has been sent.");
});

test("reset password rejects an invalid or missing token", async () => {
    const originalFindOne = db.PasswordResetToken?.findOne;
    if (db.PasswordResetToken) {
        db.PasswordResetToken.findOne = async () => null;
    }

    const req = {
        body: { token: "missing-token", newPassword: "new-password" },
        headers: {},
        ip: "127.0.0.11"
    };
    const res = createRes();

    await authController.resetPassword(req, res, () => {
        throw new Error("next should not be called");
    });

    assert.equal(res.statusCode, 400);
    assert.match(res.body.msg, /invalid or has expired/i);

    if (db.PasswordResetToken) {
        db.PasswordResetToken.findOne = originalFindOne;
    }
});

test("field encryption decrypts new encrypted values and keeps plain values readable", () => {
    process.env.FIELD_ENCRYPTION_KEY = "test-encryption-key";

    const encrypted = encrypt("123456789");
    assert.notEqual(encrypted, "123456789");
    assert.equal(decrypt(encrypted), "123456789");
    assert.equal(decrypt("legacy-plain-value"), "legacy-plain-value");
});

test("secure file endpoint denies access when requester is not authorized", async () => {
    const uploadsDir = path.join(__dirname, "..", "uploads", "documents");
    const filePath = path.join(uploadsDir, "security-test.txt");
    fs.mkdirSync(uploadsDir, { recursive: true });
    fs.writeFileSync(filePath, "test");

    const originalFindOne = db.Application.findOne;
    const originalEmployerFindOne = db.EmployerProfile.findOne;
    const originalAlumniFindOne = db.AlumniProfile.findOne;

    db.Application.findOne = async () => null;
    db.EmployerProfile.findOne = async () => null;
    db.AlumniProfile.findOne = async () => null;

    const req = {
        params: { folder: "documents", fileName: "security-test.txt" },
        user: { id: 999, role: "alumni" }
    };
    const res = createRes();
    let nextCalled = false;

    await fileController.getSecureFile(req, res, () => {
        nextCalled = true;
    });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.msg, "You are not allowed to access this file.");

    db.Application.findOne = originalFindOne;
    db.EmployerProfile.findOne = originalEmployerFindOne;
    db.AlumniProfile.findOne = originalAlumniFindOne;
    fs.unlinkSync(filePath);
});

test("application document endpoint denies users unrelated to the application", async () => {
    const originalFindByPk = db.Application.findByPk;
    const originalDocumentFindOne = db.ApplicationDocument.findOne;
    let documentLookupCalled = false;
    db.Application.findByPk = async () => ({
        id: 321,
        alumni_id: 7,
        Job: { id: 45, employer_id: 9 }
    });
    db.ApplicationDocument.findOne = async () => {
        documentLookupCalled = true;
        return null;
    };

    try {
        const req = {
            params: { id: "321", documentId: "654" },
            user: { id: 100, role: "employer" }
        };
        const res = createRes();
        await applicationController.getApplicationDocumentFile(req, res, (err) => {
            throw err;
        });

        assert.equal(res.statusCode, 403);
        assert.equal(res.body.msg, "Not allowed to access this application document.");
        assert.equal(documentLookupCalled, false);
    } finally {
        db.Application.findByPk = originalFindByPk;
        db.ApplicationDocument.findOne = originalDocumentFindOne;
    }
});

test("adminScopeMiddleware denies access when user scope is not allowed", async () => {
    const req = { user: { id: 1, role: "admin", admin_scope: "registrar" } };
    const res = createRes();
    const nextCalled = [];
    const middleware = adminScopeMiddleware(["alumni", "employer"]);

    await middleware(req, res, () => {
        nextCalled.push(true);
    });

    assert.equal(nextCalled.length, 0);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.msg, "Admin scope access denied.");
});

test("registrar analytics endpoint returns aggregated analytics data", async () => {
    const req = { user: { id: 1, role: "admin", admin_scope: "registrar" } };
    const res = createRes();

    const originalCountUser = db.User.count;
    const originalCountJob = db.Job.count;
    const originalCountApplication = db.Application.count;
    const originalCountAlumniProfile = db.AlumniProfile.count;

    db.User.count = async ({ where }) => {
        if (where.role === "alumni" && where.account_status === undefined) return 100;
        if (where.role === "alumni" && where.account_status === "verified") return 80;
        if (where.role === "employer" && where.account_status === undefined) return 20;
        if (where.role === "employer" && where.account_status === "verified") return 18;
        return 0;
    };
    db.Job.count = async () => 75;
    db.Application.count = async () => 125;
    db.AlumniProfile.count = async ({ where }) => {
        if (where.employment_status === "employed") return 50;
        if (where.employment_status === "unemployed") return 30;
        if (where.employment_status === "self-employed") return 20;
        return 0;
    };

    await registrarController.getAnalytics(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.totalAlumni, 100);
    assert.equal(res.body.activeAlumni, 80);
    assert.equal(res.body.totalEmployers, 20);
    assert.equal(res.body.activeEmployers, 18);
    assert.equal(res.body.totalJobs, 75);
    assert.equal(res.body.totalApplications, 125);
    assert.equal(res.body.employedAlumni, 50);
    assert.equal(res.body.unemployedAlumni, 30);
    assert.equal(res.body.selfEmployedAlumni, 20);
    assert.equal(res.body.employmentRate, 50);

    db.User.count = originalCountUser;
    db.Job.count = originalCountJob;
    db.Application.count = originalCountApplication;
    db.AlumniProfile.count = originalCountAlumniProfile;
});
