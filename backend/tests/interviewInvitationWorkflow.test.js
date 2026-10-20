const test = require("node:test");
const assert = require("node:assert/strict");

const db = require("../models");
const controller = require("../controllers/applicationController");

const createResponse = () => ({
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
});

const withOverrides = async (overrides, run) => {
    const originals = overrides.map(([target, values]) => [
        target,
        Object.fromEntries(Object.keys(values).map((key) => [key, target[key]]))
    ]);
    for (const [target, values] of overrides) Object.assign(target, values);
    try {
        await run();
    } finally {
        for (const [target, values] of originals) Object.assign(target, values);
    }
};

for (const status of ["not_verified", "declined", "rejected", "approved", "ready_for_interview", "processing"]) {
    test(`invitation cannot overwrite ${status} or enqueue another email`, async () => {
        const application = { id: 702, status, Job: { id: 88, employer_id: 41 } };
        const unexpected = async () => { throw new Error("Locked decisions must not create side effects"); };
        await withOverrides([
            [db.sequelize, { transaction: async fn => fn({ LOCK: { UPDATE: "UPDATE" } }) }],
            [db.Application, { findByPk: async () => application }],
            [db.Interview, { findOne: async () => null, create: unexpected }],
            [db.EmailQueueJob, { create: unexpected }],
            [db.Notification, { create: unexpected }]
        ], async () => {
            const res = createResponse();
            let failure;
            await controller.sendInterviewInvitation(
                { user: { id: 41, role: "employer" }, params: { id: "702" } }, res,
                error => { failure = error; }
            );
            assert.equal(failure?.status, 409);
            assert.equal(application.status, status);
        });
    });
}

test("employer invitation preview returns the owning job's saved details and delivery state", async () => {
    const application = {
        id: 702,
        status: "verified",
        full_name: "Ari Applicant",
        Job: {
            id: 88,
            title: "Account Assistant",
            employer_id: 41,
            interview_venue: "Main Office",
            interview_place: "123 Rizal Street",
            interview_date: "2026-11-05",
            interview_time: "09:30",
            interview_contact_info: "jobs@example.invalid",
            interview_what_to_bring: "Portfolio"
        },
        alumni: { name: "Ari Applicant" }
    };
    await withOverrides([
        [db.Application, { findByPk: async () => application }],
        [db.Interview, { findOne: async () => ({ id: 901 }) }],
        [db.EmailQueueJob, { findOne: async () => ({ status: "failed" }) }]
    ], async () => {
        const res = createResponse();
        await controller.getInterviewInvitationDetails(
            { user: { id: 41, role: "employer" }, params: { id: "702" } },
            res,
            (error) => { throw error; }
        );
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.complete, true);
        assert.equal(res.body.already_invited, true);
        assert.equal(res.body.email_status, "failed");
        assert.equal(res.body.interview_details.date, "2026-11-05");
    });
});

test("employer cannot preview another employer's application invitation", async () => {
    const application = { id: 703, Job: { id: 89, employer_id: 42 } };
    await withOverrides([
        [db.Application, { findByPk: async () => application }],
        [db.Interview, { findOne: async () => { throw new Error("Should not query invitations for a non-owner."); } }]
    ], async () => {
        const res = createResponse();
        await controller.getInterviewInvitationDetails(
            { user: { id: 41, role: "employer" }, params: { id: "703" } },
            res,
            (error) => { throw error; }
        );
        assert.equal(res.statusCode, 403);
    });
});

test("employer-scoped admin can use the shared invitation flow for its own job", async () => {
    const application = {
        id: 706,
        status: "pending",
        Job: { id: 92, title: "Office Assistant", employer_id: 43 },
        alumni: { name: "Ari Applicant" }
    };
    await withOverrides([
        [db.Application, { findByPk: async () => application }],
        [db.Interview, { findOne: async () => null }]
    ], async () => {
        const res = createResponse();
        await controller.getInterviewInvitationDetails(
            { user: { id: 43, role: "admin", admin_scope: "employer" }, params: { id: "706" } },
            res,
            (error) => { throw error; }
        );
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.job.id, 92);
        assert.equal(res.body.complete, false);
    });
});

test("approval stores an invitation snapshot and queues one applicant email transactionally", async () => {
    const created = { notifications: [], emails: [], interview: null };
    const application = {
        id: 704,
        alumni_id: 12,
        status: "pending",
        full_name: "Ari Applicant",
        Job: {
            id: 90,
            title: "Account Assistant",
            employer_id: 41,
            User: { name: "Example Co", EmployerProfile: { organization_name: "Example Co" } },
            interview_venue: "Main Office",
            interview_place: "123 Rizal Street",
            interview_date: "2026-11-05",
            interview_time: "09:30",
            interview_contact_info: "jobs@example.invalid",
            interview_what_to_bring: "Portfolio"
        },
        alumni: { name: "Ari Applicant", email: "ari@example.invalid" },
        async save() { this.saved = true; }
    };
    await withOverrides([
        [db.sequelize, {
            transaction: async (callback) => callback({ LOCK: { UPDATE: "UPDATE" } })
        }],
        [db.Application, { findByPk: async () => application }],
        [db.Interview, {
            findOne: async () => null,
            create: async (fields) => { created.interview = { id: 905, ...fields }; return created.interview; }
        }],
        [db.Notification, { create: async (fields) => { created.notifications.push(fields); } }],
        [db.EmailQueueJob, { create: async (fields) => { created.emails.push(fields); } }],
        [db.AuditLog, { create: async () => null }]
    ], async () => {
        const res = createResponse();
        await controller.sendInterviewInvitation(
            { user: { id: 41, role: "employer" }, params: { id: "704" }, ip: "127.0.0.1" },
            res,
            (error) => { throw error; }
        );
        assert.equal(res.statusCode, 201);
        assert.equal(application.status, "verified");
        assert.equal(created.interview.place, "123 Rizal Street");
        assert.equal(created.interview.venue, "Main Office");
        assert.equal(created.interview.date, "2026-11-05");
        assert.equal(created.interview.time, "09:30");
        assert.equal(created.interview.contact_info, "jobs@example.invalid");
        assert.equal(created.interview.what_to_bring, "Portfolio");
        assert.equal(created.notifications.length, 1);
        assert.equal(created.notifications[0].userId, 12);
        assert.equal(created.notifications[0].interview_id, 905);
        assert.match(created.notifications[0].message, /Ari Applicant/);
        assert.match(created.notifications[0].message, /Account Assistant/);
        assert.match(created.notifications[0].message, /Example Co/);
        assert.match(created.notifications[0].message, /123 Rizal Street/);
        assert.match(created.notifications[0].message, /November 5, 2026/);
        assert.match(created.notifications[0].message, /09:30/);
        assert.match(created.notifications[0].message, /Portfolio/);
        assert.equal(created.emails.length, 1);
        assert.equal(created.emails[0].to, "ari@example.invalid");
        assert.match(created.emails[0].message, /jobs@example.invalid/);
        assert.equal(created.emails[0].dedupe_key, "interview-invitation:905");
        assert.equal(res.body.email_status, "pending");
    });
});

test("approval does not return success when the email queue write fails", async () => {
    const application = {
        id: 707,
        alumni_id: 13,
        status: "pending",
        Job: {
            id: 93,
            title: "Office Assistant",
            employer_id: 41,
            interview_venue: "Main Office",
            interview_place: "123 Rizal Street",
            interview_date: "2026-11-05",
            interview_time: "09:30",
            interview_contact_info: "jobs@example.invalid"
        },
        alumni: { name: "Ari Applicant", email: "ari@example.invalid" },
        async save() { this.saved = true; }
    };
    let rejectedTransaction = false;
    await withOverrides([
        [db.sequelize, {
            transaction: async (callback) => {
                try {
                    return await callback({ LOCK: { UPDATE: "UPDATE" } });
                } catch (error) {
                    rejectedTransaction = true;
                    throw error;
                }
            }
        }],
        [db.Application, { findByPk: async () => application }],
        [db.Interview, {
            findOne: async () => null,
            create: async (fields) => ({ id: 907, ...fields })
        }],
        [db.Notification, { create: async () => ({ id: 1 }) }],
        [db.EmailQueueJob, { create: async () => { throw new Error("email queue write failed"); } }]
    ], async () => {
        const res = createResponse();
        let forwardedError;
        await controller.sendInterviewInvitation(
            { user: { id: 41, role: "employer" }, params: { id: "707" } },
            res,
            (error) => { forwardedError = error; }
        );
        assert.equal(rejectedTransaction, true);
        assert.match(forwardedError.message, /email queue write failed/);
        assert.equal(res.body, null);
        assert.equal(res.statusCode, 200);
    });
});

test("approval rejects jobs without required interview details and leaves the application pending", async () => {
    const application = {
        id: 709,
        alumni_id: 14,
        status: "pending",
        Job: { id: 95, title: "Office Assistant", employer_id: 41, interview_venue: "" },
        alumni: { name: "Ari Applicant", email: "ari@example.invalid" }
    };
    let interviewCreates = 0;
    let notificationCreates = 0;
    let queueCreates = 0;
    await withOverrides([
        [db.sequelize, { transaction: async (callback) => callback({ LOCK: { UPDATE: "UPDATE" } }) }],
        [db.Application, { findByPk: async () => application }],
        [db.Interview, { findOne: async () => null, create: async () => { interviewCreates += 1; } }],
        [db.Notification, { create: async () => { notificationCreates += 1; } }],
        [db.EmailQueueJob, { create: async () => { queueCreates += 1; } }]
    ], async () => {
        const res = createResponse();
        let forwardedError;
        await controller.sendInterviewInvitation(
            { user: { id: 41, role: "employer" }, params: { id: "709" } },
            res,
            (error) => { forwardedError = error; }
        );
        assert.equal(forwardedError.status, 400);
        assert.match(forwardedError.message, /venue/i);
        assert.equal(application.status, "pending");
        assert.equal(interviewCreates, 0);
        assert.equal(notificationCreates, 0);
        assert.equal(queueCreates, 0);
        assert.equal(res.body, null);
    });
});

test("email delivery check reports current state and retries only exhausted failed jobs", async () => {
    const application = { id: 708, Job: { id: 94, employer_id: 41 } };
    const interview = { id: 908 };
    for (const status of ["pending", "processing", "sent", "failed"]) {
        let updateArgs = null;
        await withOverrides([
            [db.Application, { findByPk: async () => application }],
            [db.Interview, { findOne: async () => interview }],
            [db.EmailQueueJob, {
                findOne: async () => ({ id: 100 + status.length, status, attempts: 3, last_error: JSON.stringify({ code: "EMAIL_API", responseCode: 429 }) }),
                update: async (...args) => { updateArgs = args; return [1]; },
                findByPk: async () => ({ status: "pending" })
            }]
        ], async () => {
            const res = createResponse();
            await controller.retryInterviewInvitationEmail(
                { user: { id: 41, role: "employer" }, params: { id: "708" } },
                res,
                (error) => { throw error; }
            );
            if (status === "failed") {
                assert.deepEqual(updateArgs[1].where, { id: 100 + status.length, status: "failed", attempts: 3, last_error: JSON.stringify({ code: "EMAIL_API", responseCode: 429 }) });
                assert.equal(res.body.email_status, "pending");
            } else {
                assert.equal(updateArgs, null);
                assert.equal(res.body.email_status, status);
            }
        });
    }
});

test("a repeated approval request is rejected without creating another invitation", async () => {
    const existingInterview = { id: 906 };
    const application = {
        id: 705,
        status: "verified",
        Job: { id: 91, employer_id: 41 }
    };
    let interviewCreates = 0;
    let notificationCreates = 0;
    await withOverrides([
        [db.sequelize, { transaction: async (callback) => callback({ LOCK: { UPDATE: "UPDATE" } }) }],
        [db.Application, { findByPk: async () => application }],
        [db.Interview, {
            findOne: async () => existingInterview,
            create: async () => { interviewCreates += 1; }
        }],
        [db.Notification, { create: async () => { notificationCreates += 1; } }]
    ], async () => {
        const res = createResponse();
        await controller.sendInterviewInvitation(
            { user: { id: 41, role: "employer" }, params: { id: "705" } },
            res,
            (error) => { res.status(error.status).json({ msg: error.message }); }
        );
        assert.equal(res.statusCode, 409);
        assert.equal(interviewCreates, 0);
        assert.equal(notificationCreates, 0);
    });
});
