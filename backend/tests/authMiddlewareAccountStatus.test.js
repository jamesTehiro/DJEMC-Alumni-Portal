const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = "auth-account-status-fixture-secret";

const db = require("../models");
const authenticate = require("../middleware/authMiddleware");

const createResponse = () => ({
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
});

const requestFor = (claims) => ({
    headers: claims ? { authorization: `Bearer ${jwt.sign(claims, process.env.JWT_SECRET)}` } : {}
});

test("authentication middleware checks current account state and uses database roles", async (t) => {
    const originalFindByPk = db.User.findByPk;
    try {
        await t.test("deactivated and suspended accounts cannot reuse existing JWTs", async () => {
            for (const account_status of ["deactivated", "suspended"]) {
                db.User.findByPk = async () => ({ id: 8, role: "alumni", admin_scope: null, account_status });
                const res = createResponse();
                let nextCalled = false;
                await authenticate(requestFor({ id: 8, role: "alumni" }), res, () => { nextCalled = true; });
                assert.equal(res.statusCode, 403);
                assert.equal(nextCalled, false);
            }
        });

        await t.test("deleted accounts lose existing tokens and active accounts use current database scope", async () => {
            db.User.findByPk = async () => null;
            const missing = createResponse();
            await authenticate(requestFor({ id: 9, role: "admin", admin_scope: "employer" }), missing, () => {});
            assert.equal(missing.statusCode, 401);

            db.User.findByPk = async () => ({ id: 10, role: "admin", admin_scope: "alumni", account_status: "verified" });
            const active = createResponse();
            const activeRequest = requestFor({ id: 10, role: "admin", admin_scope: "employer" });
            let nextCalled = false;
            await authenticate(activeRequest, active, () => { nextCalled = true; });
            assert.equal(active.statusCode, 200);
            assert.equal(nextCalled, true);
            assert.equal(activeRequest.user.role, "admin");
            assert.equal(activeRequest.user.admin_scope, "alumni");
        });

        await t.test("database failure fails closed and missing credentials remain 401", async () => {
            db.User.findByPk = async () => { throw new Error("fixture database failure"); };
            const unavailable = createResponse();
            await authenticate(requestFor({ id: 12, role: "employer" }), unavailable, () => {});
            assert.equal(unavailable.statusCode, 503);

            const missing = createResponse();
            await authenticate(requestFor(null), missing, () => {});
            assert.equal(missing.statusCode, 401);
        });
    } finally {
        db.User.findByPk = originalFindByPk;
    }
});
