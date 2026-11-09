const test = require("node:test");
const assert = require("node:assert/strict");
const db = require("../models");
const admin = require("../controllers/adminController");

const response = () => ({
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
});

const call = async (handler, userId, body) => {
    const res = response();
    await handler({ params: { userId: String(userId) }, body, user: { id: 3 }, ip: "127.0.0.1" }, res);
    return res;
};

test("alumni and employer status actions require eligible, previously verified accounts", async (t) => {
    const originals = {
        transaction: db.sequelize.transaction,
        userFindAll: db.User.findAll,
        userFindOne: db.User.findOne,
        userFindByPk: db.User.findByPk,
        userUpdate: db.User.update,
        profileUpdateRequestFindAll: db.AlumniProfileUpdateRequest.findAll,
        auditFindAll: db.AuditLog.findAll,
        auditFindOne: db.AuditLog.findOne,
        auditCreate: db.AuditLog.create,
        profileFindOrCreate: db.EmployerProfile.findOrCreate
    };
    const auditEvents = [];
    const employerProfile = { verified: true, save: async () => {} };
    let alumni = { id: 71, role: "alumni", account_status: "verified", save: async () => {} };
    let employer = { id: 82, role: "employer", account_status: "verified", save: async () => {} };

    db.sequelize.transaction = callback => callback({ LOCK: { UPDATE: "UPDATE" } });
    db.User.findOne = async ({ where }) => {
        const selected = where.role === "alumni" ? alumni : employer;
        if (where.id != null && Number(where.id) !== selected.id) return null;
        if (where.account_status?.[db.Sequelize.Op.in] && !where.account_status[db.Sequelize.Op.in].includes(selected.account_status)) return null;
        if (where.account_status && typeof where.account_status === "string" && where.account_status !== selected.account_status) return null;
        return selected;
    };
    db.User.findByPk = async id => Number(id) === employer.id ? employer : null;
    db.User.update = async (values, { where }) => {
        if (Number(where.id) !== employer.id || where.role !== "employer" || !where.account_status[db.Sequelize.Op.in].includes(employer.account_status)) return [0];
        employer.account_status = values.account_status;
        return [1];
    };
    db.AuditLog.findOne = async ({ where }) => auditEvents.findLast(event =>
        event.target_type === where.target_type && event.target_id === where.target_id && event.action === where.action
    ) || null;
    db.AuditLog.findAll = async ({ where }) => auditEvents.filter(event => {
        const targetMatches = Array.isArray(where.target_id) ? where.target_id.includes(event.target_id) : event.target_id === where.target_id;
        const actionMatches = Array.isArray(where.action) ? where.action.includes(event.action) : event.action === where.action;
        return event.target_type === where.target_type && targetMatches && actionMatches;
    });
    db.AuditLog.create = async event => { auditEvents.push(event); return event; };
    db.EmployerProfile.findOrCreate = async () => [employerProfile, false];

    try {
        await t.test("alumni can be deactivated and reactivated only from a verified history", async () => {
            const deactivated = await call(admin.updateAlumniUserStatus, alumni.id, { status: "deactivated", action: "deactivate" });
            assert.equal(deactivated.statusCode, 200);
            assert.equal(deactivated.body.user.account_status, "deactivated");
            const reactivated = await call(admin.updateAlumniUserStatus, alumni.id, { status: "verified", action: "reactivate" });
            assert.equal(reactivated.statusCode, 200);
            assert.equal(reactivated.body.user.account_status, "verified");
            assert.equal(auditEvents.at(-1).actor_id, 3);
            assert.equal(auditEvents.at(-1).metadata.action, "reactivate");

            alumni.account_status = "suspended";
            auditEvents.push({ target_type: "alumni", target_id: alumni.id, action: "alumni.account_status.changed", metadata: { from: "pending", to: "suspended" } });
            const legacyHistory = await call(admin.updateAlumniUserStatus, alumni.id, { status: "verified", action: "reactivate" });
            assert.equal(legacyHistory.statusCode, 200, "older verification history must be honored even when the latest event is not from verified");

            alumni.account_status = "pending";
            const pending = await call(admin.updateAlumniUserStatus, alumni.id, { status: "verified", action: "reactivate" });
            assert.equal(pending.statusCode, 409);
            assert.equal(alumni.account_status, "pending");
        });

        await t.test("employers can be deactivated and reactivated; unverified inactive accounts stay blocked", async () => {
            const deactivated = await call(admin.updateEmployerUserStatus, employer.id, { status: "deactivated", action: "deactivate" });
            assert.equal(deactivated.statusCode, 200);
            assert.equal(deactivated.body.user.account_status, "deactivated");
            assert.equal(employerProfile.verified, false);

            const reactivated = await call(admin.updateEmployerUserStatus, employer.id, { status: "verified", action: "reactivate" });
            assert.equal(reactivated.statusCode, 200);
            assert.equal(reactivated.body.user.account_status, "verified");
            assert.equal(employerProfile.verified, true);

            employer = { id: 82, role: "employer", account_status: "suspended", save: async () => {} };
            auditEvents.length = 0;
            const withoutHistory = await call(admin.updateEmployerUserStatus, employer.id, { status: "verified", action: "reactivate" });
            assert.equal(withoutHistory.statusCode, 409);
            assert.equal(employer.account_status, "suspended");
            auditEvents.push({ target_type: "employer", target_id: employer.id, action: "employer.verification.approved", metadata: {} });
            const approvedPreviously = await call(admin.updateEmployerUserStatus, employer.id, { status: "verified", action: "reactivate" });
            assert.equal(approvedPreviously.statusCode, 200);
            assert.equal(approvedPreviously.body.user.account_status, "verified");
        });

        await t.test("invalid IDs and missing action markers are rejected", async () => {
            assert.equal((await call(admin.updateAlumniUserStatus, "NaN", { status: "deactivated", action: "deactivate" })).statusCode, 400);
            assert.equal((await call(admin.updateEmployerUserStatus, employer.id, { status: "deactivated" })).statusCode, 400);
            assert.equal((await call(admin.updateEmployerUserStatus, "NaN", { status: "verified", action: "reactivate" })).statusCode, 400);
        });

        await t.test("account lists allow reactivation from prior verification while leaving accounts without proof unavailable", async () => {
            auditEvents.length = 0;
            auditEvents.push(
                { target_type: "alumni", target_id: 71, action: "alumni.account_status.changed", metadata: { from: "verified", to: "deactivated" } },
                { target_type: "alumni", target_id: 71, action: "alumni.account_status.changed", metadata: { from: "deactivated", to: "suspended" } },
                { target_type: "employer", target_id: 82, action: "employer.verification.approved", metadata: { to: "verified" } },
                { target_type: "employer", target_id: 82, action: "employer.account_status.changed", metadata: { from: "deactivated", to: "suspended" } }
            );
            const alumniListUser = { id: 71, role: "alumni", account_status: "suspended", toJSON() { return { id: this.id, role: this.role, account_status: this.account_status }; } };
            const employerListUsers = [82, 83].map(id => ({
                id, role: "employer", account_status: "deactivated", EmployerProfile: null,
                toJSON() { return { id: this.id, role: this.role, account_status: this.account_status, EmployerProfile: null }; }
            }));
            db.User.findAll = async ({ where }) => where.role === "alumni" ? [alumniListUser] : employerListUsers;
            db.AlumniProfileUpdateRequest.findAll = async () => [];
            const alumniList = response();
            await admin.getAlumniUsers({}, alumniList);
            assert.equal(alumniList.body[0].can_reactivate, true);
            const employerList = response();
            await admin.getEmployerUsers({}, employerList);
            assert.equal(employerList.body.find(user => user.id === 82).can_reactivate, true);
            assert.equal(employerList.body.find(user => user.id === 83).can_reactivate, false);
        });
    } finally {
        db.sequelize.transaction = originals.transaction;
        db.User.findAll = originals.userFindAll;
        db.User.findOne = originals.userFindOne;
        db.User.findByPk = originals.userFindByPk;
        db.User.update = originals.userUpdate;
        db.AlumniProfileUpdateRequest.findAll = originals.profileUpdateRequestFindAll;
        db.AuditLog.findAll = originals.auditFindAll;
        db.AuditLog.findOne = originals.auditFindOne;
        db.AuditLog.create = originals.auditCreate;
        db.EmployerProfile.findOrCreate = originals.profileFindOrCreate;
    }
});
