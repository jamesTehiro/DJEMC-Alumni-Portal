const test = require("node:test");
const assert = require("node:assert/strict");
const db = require("../models");
const controller = require("../controllers/applicationController");
const notificationController = require("../controllers/notificationController");
const auditService = require("../services/auditService");

const auditEvents = [];
const originalAuditLog = auditService.log;
auditService.log = async (event) => auditEvents.push(event);

test.after(async () => {
    auditService.log = originalAuditLog;
    await db.sequelize.close();
});

const response = () => ({
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
});

const callWithApplication = async (handler, req, application) => {
    const original = db.Application.findByPk;
    db.Application.findByPk = async () => application;
    try {
        const res = response();
        await handler(req, res, (err) => { throw err; });
        return res;
    } finally {
        db.Application.findByPk = original;
    }
};

test("employer can archive and restore only an application for its own job", async () => {
    auditEvents.length = 0;
    const writes = [];
    const application = {
        id: 71,
        is_archived: false,
        Job: { id: 31, employer_id: 12 },
        async update(values) {
            writes.push(values);
            Object.assign(this, values);
        },
        toJSON() { return { id: this.id, is_archived: this.is_archived, Job: this.Job }; }
    };

    const archived = await callWithApplication(controller.archiveEmployerApplication, {
        user: { id: 12, role: "employer" }, params: { id: "71" }
    }, application);
    assert.equal(archived.statusCode, 200);
    assert.equal(archived.body.application.is_archived, true);

    const restored = await callWithApplication(controller.restoreEmployerApplication, {
        user: { id: 12, role: "employer" }, params: { id: "71" }
    }, application);
    assert.equal(restored.statusCode, 200);
    assert.equal(restored.body.application.is_archived, false);
    assert.deepEqual(writes, [{ is_archived: true }, { is_archived: false }]);
    assert.deepEqual(auditEvents.map((event) => event.action), ["application.archived", "application.restored"]);
});

test("employer cannot archive another employer's application", async () => {
    let updated = false;
    const application = {
        id: 72,
        is_archived: false,
        Job: { id: 32, employer_id: 99 },
        async update() { updated = true; },
        toJSON() { return { id: this.id, is_archived: this.is_archived }; }
    };
    const res = await callWithApplication(controller.archiveEmployerApplication, {
        user: { id: 12, role: "employer" }, params: { id: "72" }
    }, application);
    assert.equal(res.statusCode, 403);
    assert.equal(updated, false);
});

test("employer admin credentials do not bypass employer ownership for archive actions", async () => {
    const res = await callWithApplication(controller.restoreEmployerApplication, {
        user: { id: 4, role: "admin", admin_scope: "employer" }, params: { id: "73" }
    }, { id: 73, Job: { id: 33, employer_id: 12 } });
    assert.equal(res.statusCode, 403);
});

test("approving an application does not set its independent archive flag", async () => {
    const originals = {
        transaction: db.sequelize.transaction,
        findJob: db.Job.findByPk,
        maxCycle: db.Application.max,
        updateApplication: db.Application.update,
        notification: db.Notification.create,
        audit: db.AuditLog.create,
        findByPk: db.Application.findByPk,
        findInterview: db.Interview.findOne,
        createInterview: db.Interview.create,
        findEmployer: db.User.findByPk,
        createNotification: notificationController.createNotification
    };
    const application = {
        id: 74,
        job_id: 34,
        recruitment_cycle: 1,
        status: "pending",
        is_archived: false,
        alumni_id: 18,
        Job: { id: 34, employer_id: 12, title: "Office Assistant" },
        alumni: { id: 18, name: "Test Applicant", email: "applicant@example.invalid" },
        async save() {},
        toJSON() { return { ...this, toJSON: undefined }; }
    };
    db.Application.findByPk = async () => application;
    db.sequelize.transaction = async fn => fn({ LOCK: { UPDATE: "UPDATE" } });
    db.Job.findByPk = async () => application.Job;
    db.Application.max = async () => 1;
    db.Application.update = async (values, options) => {
        assert.equal(options.where.is_archived, false);
        assert.equal(Object.hasOwn(values, "is_archived"), false);
        return [1];
    };
    db.Notification.create = async () => ({});
    db.AuditLog.create = async () => ({});
    db.Interview.findOne = async () => null;
    db.Interview.create = async (fields) => ({ id: 1, ...fields });
    db.User.findByPk = async () => ({ name: "Employer", EmployerProfile: { organization_name: "Example Co" } });
    notificationController.createNotification = async () => [];

    try {
        const res = response();
        await controller.reviewApplication({
            user: { id: 12, role: "employer" },
            params: { id: "74" },
            body: {
                status: "verified",
                job_id: 34,
                recruitment_cycle: 1,
                venue: "Main Office",
                place: "1 Main Street",
                date: "2026-11-01",
                time: "09:00",
                contact_info: "jobs@example.invalid"
            }
        }, res, (error) => { throw error; });

        assert.equal(res.statusCode, 200);
        assert.equal(application.status, "verified");
        assert.equal(application.is_archived, false);
    } finally {
        db.sequelize.transaction = originals.transaction;
        db.Job.findByPk = originals.findJob;
        db.Application.max = originals.maxCycle;
        db.Application.update = originals.updateApplication;
        db.Notification.create = originals.notification;
        db.AuditLog.create = originals.audit;
        db.Application.findByPk = originals.findByPk;
        db.Interview.findOne = originals.findInterview;
        db.Interview.create = originals.createInterview;
        db.User.findByPk = originals.findEmployer;
        notificationController.createNotification = originals.createNotification;
    }
});
