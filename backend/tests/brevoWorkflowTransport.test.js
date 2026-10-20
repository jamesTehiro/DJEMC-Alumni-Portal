const test = require("node:test");
const assert = require("node:assert/strict");
const db = require("../models");
const registrar = require("../controllers/registrarController");
const admin = require("../controllers/adminController");
const applications = require("../controllers/applicationController");
const jobsController = require("../controllers/jobController");
const announcements = require("../controllers/announcementController");
const audit = require("../services/auditService");
const worker = require("../workers/emailQueueWorker");
test.after(() => db.sequelize.close());
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
const forward = error => { throw error; };

async function fixture(run) {
    const keys = ["EMAIL_PROVIDER", "BREVO_API_KEY", "EMAIL_FROM", "EMAIL_FROM_NAME"];
    const savedEnv = Object.fromEntries(keys.map(key => [key, process.env[key]])), savedFetch = global.fetch;
    const changes = [], users = new Map(), queue = [], notices = [], requests = [];
    const change = (target, key, value) => { changes.push([target, key, target[key]]); target[key] = value; };
    const transaction = { LOCK: { UPDATE: "UPDATE" } };
    const enqueue = values => {
        const row = { id: queue.length + 1, attempts: 0, max_attempts: 5, status: "pending", scheduled_at: new Date(), ...values };
        queue.push(row); return row;
    };
    Object.assign(process.env, { EMAIL_PROVIDER: "brevo", BREVO_API_KEY: "workflow-fixture-key", EMAIL_FROM: "sender@example.invalid", EMAIL_FROM_NAME: "DJEMC Portal" });
    global.fetch = async (url, options) => {
        assert.equal(url, "https://api.brevo.com/v3/smtp/email");
        assert.equal(options.headers["api-key"], "workflow-fixture-key");
        requests.push(JSON.parse(options.body));
        return Response.json({ messageId: `<workflow-${requests.length}@brevo.invalid>` }, { status: 201 });
    };
    change(db.sequelize, "query", async () => { throw Error("Unexpected real SQL in an isolated workflow test"); });
    change(db.sequelize, "transaction", async fn => fn(transaction));
    change(audit, "log", async () => {});
    change(db.AuditLog, "create", async fields => fields);
    change(db.User, "findByPk", async id => users.get(Number(id)));
    change(db.User, "findOne", async ({ where }) => [...users.values()].find(user => Object.entries(where).every(([key, value]) => String(user[key]) === String(value))));
    change(db.User, "findAll", async ({ where }) => [...users.values()].filter(user => where.id ? where.id.includes(user.id) : Object.entries(where).every(([key, value]) => user[key] === value)));
    change(db.Notification, "bulkCreate", async fields => { notices.push(...fields); return fields; });
    change(db.Notification, "create", async fields => { const row = { id: notices.length + 1, ...fields }; notices.push(row); return row; });
    change(db.EmailQueueJob, "bulkCreate", async fields => fields.map(enqueue));
    change(db.EmailQueueJob, "create", async fields => enqueue(fields));
    change(db.EmailQueueJob, "findOne", async ({ where }) => queue.find(row => Object.entries(where).every(([key, value]) => row[key] === value)));
    change(db.EmailQueueJob, "findByPk", async id => queue.find(row => row.id === id));
    change(db.EmailQueueJob, "update", async (values, { where }) => {
        const row = queue.find(row => Object.entries(where).every(([key, value]) => row[key] === value));
        if (!row) return [0]; Object.assign(row, values); return [1];
    });
    const flush = async () => {
        for (const row of queue.filter(row => row.status === "pending")) {
            Object.assign(row, { status: "processing", processing_started_at: new Date(), attempts: row.attempts + 1 });
            await worker.processJob(row);
            assert.equal(row.status, "sent");
            const request = requests.at(-1);
            assert.deepEqual(request.to, [{ email: row.to }]);
            assert.equal(request.subject, row.subject); assert.equal(request.textContent, row.message);
        }
    };
    try { await run({ change, users, queue, notices, requests, flush }); }
    finally {
        for (const [target, key, value] of changes.reverse()) target[key] = value;
        global.fetch = savedFetch;
        keys.forEach(key => savedEnv[key] === undefined ? delete process.env[key] : process.env[key] = savedEnv[key]);
    }
}

test("Registrar approval and rejection keep original recipients/templates through queue to Brevo", () => fixture(async f => {
    f.change(db.AlumniRecord, "findByPk", async () => ({ id: 8 }));
    for (const [index, action] of ["approveAlumniUser", "rejectAlumniUser"].entries()) {
        const user = { id: index + 10, role: "alumni", email: `alumni${index}@example.invalid`, account_status: "pending", async save() {} };
        f.users.set(user.id, user);
        const res = response();
        await registrar[action]({ params: { id: user.id }, body: { alumni_record_id: 8 }, user: { id: 1, role: "admin" } }, res);
        assert.equal(res.statusCode, 200);
        assert.equal(user.account_status, index ? "rejected" : "verified");
    }
    await f.flush(); assert.equal(f.requests.length, 2); assert.equal(f.notices.length, 2);
    assert.deepEqual(f.requests.map(row => row.subject), ["DJEMC Alumni Account Verified", "DJEMC Alumni Registration Not Approved"]);
}));

test("employer approval/rejection and repeated-decision protection preserve queue dedupe keys over Brevo", () => fixture(async f => {
    const profile = { organization_name: "Fixture Organization", async save() {} };
    f.change(db.EmployerProfile, "findOrCreate", async () => [profile]);
    for (const [index, status] of ["verified", "rejected"].entries()) {
        const user = { id: 20 + index, role: "employer", name: "Fixture Employer", email: `employer${index}@example.invalid`, account_status: "pending", async save() {} };
        f.users.set(user.id, user);
        const req = { params: { userId: user.id }, body: { status, reason: "Existing proof required" }, user: { id: 1, role: "admin", admin_scope: "employer" } };
        const res = response(); await admin.updateEmployerUserStatus(req, res);
        assert.equal(res.statusCode, 200); assert.equal(user.account_status, status);
        assert.equal(f.queue.at(-1).dedupe_key, `employer-verification:${user.id}:${status}`);
        const repeated = response(); await admin.updateEmployerUserStatus(req, repeated);
        assert.equal(repeated.statusCode, 409);
    }
    await f.flush(); assert.equal(f.requests.length, 2);
    assert.match(f.requests[0].textContent, /approved/); assert.match(f.requests[1].textContent, /Existing proof required/);
}));

test("new job alert preserves verified-alumni targeting and dynamic text through Brevo", () => fixture(async f => {
    f.users.set(18, { id: 18, name: "Verified Employer", role: "employer", account_status: "verified" });
    f.users.set(91, { id: 91, role: "alumni", account_status: "verified", email: "graduate@example.invalid" });
    f.users.set(92, { id: 92, role: "alumni", account_status: "pending", email: "pending@example.invalid" });
    f.change(db.EmployerProfile, "findOne", async () => ({ organization_name: "Fixture Company" }));
    let saved;
    f.change(db.Job, "create", async values => { saved = { id: 501, ...values }; return saved; });
    f.change(db.Job, "findByPk", async () => saved);
    const res = response();
    await jobsController.createJob({ user: { id: 18, role: "employer" }, body: { title: "Records Assistant", description: "Manage records", location: "San Jose", employment_type: "Full-Time" } }, res);
    assert.equal(res.statusCode, 200); await f.flush(); assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].subject, "New Job Opportunity");
    assert.equal(f.requests[0].to[0].email, "graduate@example.invalid");
    assert.match(f.requests[0].textContent, /Records Assistant.*Fixture Company/);
}));

test("requirement revision keeps applicant notes as plain text and preserves in-app notification", () => fixture(async f => {
    f.users.set(12, { id: 12, role: "alumni", email: "applicant@example.invalid" });
    f.change(db.Application, "findByPk", async () => ({ id: 74, alumni_id: 12, Job: { employer_id: 41 } }));
    f.change(db.ApplicationDocument, "findOne", async () => ({ id: 2, async save() {} }));
    f.change(db.ApplicationResponse, "findOne", async () => null);
    const res = response();
    await applications.reviewRequirement({ user: { id: 41, role: "employer" }, params: { id: 74, code: "TOR" }, body: { status: "needs_revision", notes: "<b>Original notes</b>" } }, res, forward);
    assert.equal(res.statusCode, 200); await f.flush(); assert.equal(f.notices.length, 1);
    assert.equal(f.requests[0].subject, "Application Revision Required");
    assert.match(f.requests[0].textContent, /<b>Original notes<\/b>/); assert.equal(f.requests[0].htmlContent, undefined);
}));

test("interview approval sends the existing snapshot once; ambiguous failures cannot be blindly retried", () => fixture(async f => {
    const application = { id: 704, alumni_id: 12, status: "pending", alumni: { name: "Fixture Applicant", email: "applicant@example.invalid" },
        Job: { id: 90, title: "Records Assistant", employer_id: 41, User: { name: "Fixture Organization" }, interview_venue: "Office", interview_place: "Campus", interview_date: "2026-11-05", interview_time: "09:30", interview_contact_info: "jobs@example.invalid", interview_what_to_bring: "Portfolio" }, async save() {} };
    f.change(db.Application, "findByPk", async () => application);
    let interview;
    f.change(db.Interview, "findOne", async () => interview || null);
    f.change(db.Interview, "create", async values => { interview = { id: 905, ...values }; return interview; });
    const req = { user: { id: 41, role: "employer" }, params: { id: 704 } };
    const res = response(); await applications.sendInterviewInvitation(req, res, forward);
    assert.equal(res.statusCode, 201); assert.equal(application.status, "verified"); assert.equal(f.notices.length, 1);
    assert.equal(f.queue[0].dedupe_key, "interview-invitation:905");
    await f.flush(); assert.equal(f.requests.length, 1); assert.match(f.requests[0].textContent, /Portfolio/);
    const accepted = response(); await applications.retryInterviewInvitationEmail(req, accepted, forward);
    assert.match(accepted.body.msg, /Inbox delivery is not confirmed/); assert.equal(f.requests.length, 1);
    const row = f.queue[0]; row.status = "failed";
    for (const lastError of [null, "old private text", JSON.stringify({ code: "ETIMEDOUT" }), JSON.stringify({ code: "EMAIL_API", responseCode: 503 }), JSON.stringify({ code: "EMAIL_AMBIGUOUS" })]) {
        row.last_error = lastError;
        const held = response(); await applications.retryInterviewInvitationEmail(req, held, forward);
        assert.equal(held.statusCode, 409); assert.equal(held.body.code, "EMAIL_REVIEW_REQUIRED"); assert.equal(row.status, "failed");
    }
    row.last_error = JSON.stringify({ code: "EMAIL_API", responseCode: 429 });
    const retry = response(); await applications.retryInterviewInvitationEmail(req, retry, forward);
    assert.equal(retry.body.email_status, "pending"); assert.equal(f.requests.length, 1);
    await f.flush(); assert.equal(f.requests.length, 2); assert.equal(f.queue.length, 1);
}));

test("admin warning and announcement reuse the existing helper queue and Brevo adapter", () => fixture(async f => {
    f.users.set(12, { id: 12, role: "alumni", email: "graduate@example.invalid" });
    f.change(db.Announcement, "create", async values => ({ id: 8, ...values }));
    const warning = response(); await admin.createAlumniWarning({ body: { userId: 12, message: "Existing warning" } }, warning);
    const announcement = response(); await announcements.createAnnouncement({ body: { title: "Existing title", content: "Existing content" }, user: { id: 1 } }, announcement);
    assert.equal(warning.statusCode, 200); assert.equal(announcement.statusCode, 200);
    await f.flush(); assert.equal(f.requests.length, 2); assert.equal(f.notices.length, 2);
}));

test("a concurrent newer ambiguous failure cannot be overwritten by an earlier safe retry decision", () => fixture(async f => {
    f.change(db.Application, "findByPk", async () => ({ id: 704, Job: { employer_id: 41 } }));
    f.change(db.Interview, "findOne", async () => ({ id: 905 }));
    const row = await db.EmailQueueJob.create({ dedupe_key: "interview-invitation:905", status: "failed", attempts: 1, last_error: JSON.stringify({ code: "EMAIL_API", responseCode: 429 }) });
    const update = db.EmailQueueJob.update;
    f.change(db.EmailQueueJob, "update", async (values, options) => {
        row.last_error = JSON.stringify({ code: "EMAIL_AMBIGUOUS" });
        return update(values, options);
    });
    const res = response();
    await applications.retryInterviewInvitationEmail({ user: { id: 41, role: "employer" }, params: { id: 704 } }, res, forward);
    assert.equal(res.statusCode, 409); assert.equal(row.status, "failed");
    assert.equal(JSON.parse(row.last_error).code, "EMAIL_AMBIGUOUS");
    assert.equal(f.requests.length, 0);
}));
