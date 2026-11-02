const test = require("node:test");
const assert = require("node:assert/strict");
const db = require("../models");
const controller = require("../controllers/applicationController");
const { buildApplicationDecisionEmail, queueApplicationDecisionEmail } = require("../utils/applicationDecisionEmail");
const worker = require("../workers/emailQueueWorker");
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

async function fixture(run) {
    const state = {
        application: { id: 74, job_id: 34, alumni_id: 18, recruitment_cycle: 2, status: "pending", is_archived: false,
            email: "untrusted@example.invalid", review_notes: "Private employer notes", ApplicationDocuments: [{ id: 9, file_path: "private-resume.pdf" }],
            JobRequirementSnapshot: { version: 3, snapshot_data: { requirements: ["Original requirement"] } } },
        job: { id: 34, employer_id: 12, title: "Office Assistant" },
        applicant: { id: 18, name: "Registered Applicant", role: "alumni", account_status: "verified", email: "registered.applicant+portal@gmail.com", email_verified_at: new Date("2026-10-25T00:00:00Z") },
        owner: { id: 12, name: "Job Owner", EmployerProfile: { organization_name: "Original Company" } },
        notifications: [], audits: [], queue: [], logs: [], requests: [], lookups: [], commits: 0, failUpdate: false, failNotification: false, failQueue: false, failCommit: false, providerStatus: 201
    };
    const originals = [];
    const change = (target, key, value) => { originals.push([target, key, target[key]]); target[key] = value; };
    for (const name of ["log", "warn", "error"]) change(console, name, (...args) => state.logs.push(args));
    let tail = Promise.resolve();
    change(db.sequelize, "transaction", callback => {
        const task = tail.then(async () => {
            const before = structuredClone({ application: state.application, notifications: state.notifications, audits: state.audits });
            try {
                const result = await callback({ LOCK: { UPDATE: "UPDATE" } });
                if (state.failCommit) throw Error("Commit failed");
                state.commits++; return result;
            } catch (error) { Object.assign(state, before); throw error; }
        });
        tail = task.catch(() => {}); return task;
    });
    change(db.Job, "findByPk", async () => state.job);
    change(db.Application, "findByPk", async () => state.application);
    change(db.Application, "max", async () => 2);
    change(db.Application, "update", async (values, options) => {
        assert.ok(options.transaction); assert.equal(options.where.id, state.application.id);
        if (state.failUpdate === "throw") throw Error("Update failed");
        if (state.failUpdate || !["pending", "pending_review", "submitted"].includes(state.application.status)) return [0];
        Object.assign(state.application, values); return [1];
    });
    change(db.Notification, "create", async (values, options) => { assert.ok(options.transaction); if (state.failNotification) throw Error("In-app write failed"); state.notifications.push(values); return values; });
    change(db.AuditLog, "create", async values => { state.audits.push(values); return values; });
    change(db.User, "findByPk", async (id, options) => {
        assert.ok(state.commits > 0, "email recipient lookup occurs only after a successful decision commit");
        if (state.failRecipientLookup) throw Object.assign(Error("private@example.invalid private SQL detail"), { original: { code: "ER_BAD_FIELD_ERROR" } });
        state.lookups.push({ id, options }); return Number(id) === 18 ? state.applicant : state.owner;
    });
    change(db.EmailQueueJob, "bulkCreate", async (values, options) => {
        assert.equal(options.transaction, undefined, "email failures cannot roll back the decision");
        if (state.failQueue) throw Object.assign(Error("private@example.invalid secret-api-key private provider body"), { original: { code: "ER_NO_SUCH_TABLE" } });
        if (values.some(value => state.queue.some(row => row.dedupe_key === value.dedupe_key))) throw Object.assign(Error("duplicate"), { original: { code: "ER_DUP_ENTRY" } });
        const rows = values.map(value => ({ id: state.queue.length + 1, max_attempts: 5, ...value }));
        state.queue.push(...rows); return rows;
    });
    change(db.EmailQueueJob, "findOne", async ({ where }) => state.queue.find(row => where.dedupe_key
        ? row.dedupe_key === where.dedupe_key : row.id === where.id && row.status === where.status && row.attempts === where.attempts));
    change(db.EmailQueueJob, "update", async (values, { where }) => {
        const row = state.queue.find(row => row.id === where.id && row.status === where.status && row.attempts === where.attempts);
        if (!row) return [0]; Object.assign(row, values); return [1];
    });
    const env = ["EMAIL_PROVIDER", "BREVO_API_KEY", "EMAIL_FROM", "EMAIL_FROM_NAME"].map(key => [key, process.env[key]]);
    Object.assign(process.env, { EMAIL_PROVIDER: "brevo", BREVO_API_KEY: "secret-api-key", EMAIL_FROM: "sender@example.invalid", EMAIL_FROM_NAME: "DJEMC Portal" });
    change(global, "fetch", async (url, options) => {
        assert.equal(url, "https://api.brevo.com/v3/smtp/email");
        state.requests.push(JSON.parse(options.body));
        return { ok: state.providerStatus === 201, status: state.providerStatus, headers: { get: () => "120" }, body: { cancel: async () => {} }, json: async () => ({ messageId: "<mock-decision@brevo>" }) };
    });
    const decide = async (status, override = {}) => {
        const res = response();
        await controller.reviewApplication({ user: { id: 12, role: "employer" }, params: { id: 74 }, body: { status, job_id: 34, recruitment_cycle: 2, email: "attacker@gmail.com" }, ...override }, res, error => { res.statusCode = error.status || 500; res.body = { msg: error.message }; });
        return res;
    };
    const deliver = async () => {
        const row = state.queue[0]; Object.assign(row, { status: "processing", attempts: row.attempts + 1, processing_started_at: new Date() });
        await worker.processJob(row); return row;
    };
    try { await run({ state, decide, deliver }); }
    finally {
        for (const [target, key, original] of originals.reverse()) target[key] = original;
        for (const [key, value] of env) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
}

for (const user of [{ id: 12, role: "employer" }, { id: 99, role: "admin", admin_scope: "employer" }]) {
    for (const status of ["verified", "not_verified"]) test(`${user.role} ${status}: original in-app notification and registered-recipient Brevo queue delivery`, () => fixture(async ({ state, decide, deliver }) => {
        const documents = structuredClone(state.application.ApplicationDocuments), snapshot = structuredClone(state.application.JobRequirementSnapshot);
        const res = await decide(status, { user });
        assert.equal(res.statusCode, 200); assert.equal(state.application.status, status);
        assert.equal(state.notifications.length, 1); assert.deepEqual(state.notifications[0], {
            userId: 18, type: "application", isRead: false,
            message: status === "verified" ? "Your application for Office Assistant has been approved. Please await further instructions from the employer." : "Your application for Office Assistant was not selected for the current recruitment process."
        });
        assert.equal(state.queue.length, 1); assert.equal(state.queue[0].to, state.applicant.email);
        assert.equal(state.queue[0].dedupe_key, `job-application-decision:74:2:${status}`);
        assert.equal(state.queue[0].status, "pending"); assert.equal(state.requests.length, 0, "decision handler never calls Brevo synchronously");
        assert.deepEqual(res.body.email, { status: "queued" }); assert.doesNotMatch(JSON.stringify(res.body), /registered\.applicant|Email sent/);
        assert.deepEqual(state.application.ApplicationDocuments, documents); assert.deepEqual(state.application.JobRequirementSnapshot, snapshot);
        assert.equal(state.application.id, 74); assert.equal(state.application.recruitment_cycle, 2); assert.equal(state.application.is_archived, false);
        const row = await deliver(); assert.equal(row.status, "sent"); assert.equal(state.requests.length, 1);
        const sent = state.requests[0]; assert.deepEqual(sent.to, [{ email: state.applicant.email }]);
        assert.equal(sent.subject, `Job Application Update – ${status === "verified" ? "For Interview" : "Declined"}: Office Assistant`);
        for (const text of ["Dear Registered Applicant,", "Office Assistant", "Original Company", "Date Updated:", "Philippine Time", "Don Jose Ecleo Memorial College", "https://djemc-alumni-portal.web.app"]) assert.ok(sent.textContent.includes(text), text);
        assert.ok(sent.textContent.includes(`Application Status: ${status === "verified" ? "For Interview" : "Declined"}`));
        assert.doesNotMatch(sent.textContent, /private-resume|Private employer notes|untrusted@|attacker@|job offer|you are hired/i);
        if (status === "verified") assert.match(sent.textContent, /does not confirm an interview schedule/);
        assert.equal(sent.htmlContent, undefined, "dynamic values are sent exclusively as plain text"); assert.equal(sent.attachment, undefined);
        assert.deepEqual((await decide(status, { user })).body.email, { status: "sent" });
        assert.equal(state.requests.length, 1); assert.equal(state.queue.length, 1); assert.equal(state.notifications.length, 1);
    }));
}

test("same, competing and repeated decisions enqueue only the winning transition once", () => fixture(async ({ state, decide }) => {
    const results = await Promise.all([decide("verified"), decide("verified"), decide("not_verified")]);
    assert.deepEqual(results.map(res => res.statusCode), [200, 200, 409]);
    await decide("verified"); assert.equal(state.queue.length, 1); assert.equal(state.notifications.length, 1); assert.equal(state.audits.length, 1);
    assert.equal(state.lookups.length, 2, "duplicate requests do not even reload recipient data");
    await queueApplicationDecisionEmail({ applicationId: 74, alumniId: 18, recruitmentCycle: 2, status: "verified", job: state.job, updatedAt: new Date() });
    assert.equal(state.queue.length, 1, "the existing unique dedupe key also fences repeated processing");
}));

for (const user of [{ id: 7, role: "employer" }, { id: 12, role: "alumni" }, { id: 99, role: "admin", admin_scope: "alumni" }]) test(`unauthorized actor cannot trigger email: ${user.role}/${user.id}`, () => fixture(async ({ state, decide }) => {
    assert.equal((await decide("verified", { user })).statusCode, 403); assert.equal(state.queue.length, 0); assert.equal(state.lookups.length, 0); assert.equal(state.notifications.length, 0);
}));

for (const failure of ["compare-and-set", "update", "notification", "commit"]) test(`failed ${failure} never enqueues an email`, () => fixture(async ({ state, decide }) => {
    if (failure === "compare-and-set") state.failUpdate = true;
    if (failure === "update") state.failUpdate = "throw";
    if (failure === "notification") state.failNotification = true;
    if (failure === "commit") state.failCommit = true;
    assert.ok((await decide("not_verified")).statusCode >= 400); assert.equal(state.queue.length, 0); assert.equal(state.lookups.length, 0); assert.equal(state.application.status, "pending");
}));

test("enqueue failure is sanitized and never reverses committed decision or in-app notification", () => fixture(async ({ state, decide }) => {
    state.failQueue = true;
    const failed = await decide("verified");
    assert.equal(failed.statusCode, 200); assert.deepEqual(failed.body.email, { status: "failed", reason: "enqueue_failed" });
    assert.equal(state.application.status, "verified"); assert.equal(state.notifications.length, 1); assert.equal(state.queue.length, 0);
    const logs = JSON.stringify(state.logs); assert.match(logs, /application-decision-email/); assert.match(logs, /ER_NO_SUCH_TABLE/);
    assert.doesNotMatch(logs, /private@example|secret-api-key|Registered Applicant|private provider body|registered\.applicant/);
    state.failQueue = false;
    assert.deepEqual((await decide("verified")).body.email, { status: "queued" });
    assert.equal(state.queue.length, 1, "an authorized retry recovers the missing queue row");
    assert.equal(state.notifications.length, 1); assert.equal(state.audits.length, 1);
    await decide("verified"); assert.equal(state.queue.length, 1);
}));

test("Brevo rate limits retry the same row; ambiguous failures are held without changing the decision", () => fixture(async ({ state, decide, deliver }) => {
    await decide("verified"); const originalKey = state.queue[0].dedupe_key;
    state.providerStatus = 429; const retry = await deliver(); assert.equal(retry.status, "pending"); assert.equal(retry.attempts, 1); assert.ok(retry.scheduled_at > new Date());
    state.providerStatus = 201; await deliver(); assert.equal(retry.status, "sent"); assert.equal(state.queue.length, 1); assert.equal(retry.dedupe_key, originalKey);
    assert.equal(state.application.status, "verified"); assert.equal(state.notifications.length, 1);
}));
test("recipient lookup failure is logged safely after a successful decision", () => fixture(async ({ state, decide }) => {
    state.failRecipientLookup = true;
    const failed = await decide("verified");
    assert.equal(failed.statusCode, 200); assert.equal(failed.body.email.status, "failed"); assert.equal(state.application.status, "verified");
    assert.equal(state.notifications.length, 1); assert.equal(state.queue.length, 0);
    assert.match(JSON.stringify(state.logs), /ER_BAD_FIELD_ERROR/); assert.doesNotMatch(JSON.stringify(state.logs), /private@example|private SQL detail/);
}));
test("Brevo 503 does not roll back saved decline and does not create another queue record", () => fixture(async ({ state, decide, deliver }) => {
    await decide("not_verified"); state.providerStatus = 503; const row = await deliver();
    assert.equal(row.status, "failed"); assert.equal(JSON.parse(row.last_error).deliveryUnknown, true);
    assert.equal(state.application.status, "not_verified"); assert.equal(state.notifications.length, 1);
    assert.deepEqual((await decide("not_verified")).body.email, { status: "failed" }); assert.equal(state.queue.length, 1);
}));

for (const recipient of [null, { email: "" }, { email: "not-an-email" }, { email: "registered@example.invalid" }, { email: "x@gmail.com\r\nBcc: private@gmail.com" }, { account_status: "pending" }, { account_status: "suspended" }, { role: "employer" }]) test(`missing, invalid or unverified registered recipient is skipped safely: ${JSON.stringify(recipient)}`, () => fixture(async ({ state, decide }) => {
    state.applicant = recipient === null ? null : { ...state.applicant, ...recipient };
    const failed = await decide("verified");
    assert.equal(failed.statusCode, 200); assert.equal(failed.body.email.status, "failed"); assert.equal(state.application.status, "verified"); assert.equal(state.notifications.length, 1); assert.equal(state.queue.length, 0); assert.match(JSON.stringify(state.logs), /skipped/);
    assert.doesNotMatch(JSON.stringify(state.logs), /@gmail|@example|Registered Applicant/);
}));

test("templates use Philippine decision date, safe subject text and the existing approval meaning", () => {
    const data = { applicantName: "Applicant <script>literal text</script>", jobTitle: "Role\r\nBcc: private@example.invalid", companyName: "Company & Organization", updatedAt: new Date("2026-10-31T16:30:00Z") };
    const approved = buildApplicationDecisionEmail({ ...data, status: "verified" });
    assert.match(approved.message, /November 1, 2026/); assert.match(approved.message, /selected to proceed to the interview stage/); assert.doesNotMatch(approved.message, /job offer|hired/i);
    const declined = buildApplicationDecisionEmail({ ...data, status: "not_verified" }); assert.doesNotMatch(declined.subject, /[\r\n]/);
    assert.equal(declined.subject, "Job Application Update – Declined: Role Bcc: private@example.invalid");
    assert.ok(buildApplicationDecisionEmail({ ...data, status: "not_verified", jobTitle: "x".repeat(255) }).subject.length <= 255);
    assert.throws(() => buildApplicationDecisionEmail({ ...data, status: "pending" }));
});

for (const user of [{ id: 12, role: "employer" }, { id: 99, role: "admin", admin_scope: "employer" }]) {
    for (const status of ["verified", "not_verified"]) test(`${user.role} ${status}: legacy verified Gmail recipient uses the job-post eligibility rule`, () => fixture(async ({ state, decide, deliver }) => {
        state.applicant.email_verified_at = null;
        assert.deepEqual((await decide(status, { user })).body.email, { status: "queued" });
        assert.equal(state.queue.length, 1); assert.equal(state.queue[0].to, state.applicant.email);
        assert.equal((await deliver()).status, "sent"); assert.equal(state.requests.length, 1);
        assert.equal(state.applicant.email_verified_at, null, "notification delivery never alters verification records");
    }));
}

test("an already processing email is reported accurately without a second enqueue", () => fixture(async ({ state, decide }) => {
    await decide("verified"); state.queue[0].status = "processing";
    assert.deepEqual((await decide("verified")).body.email, { status: "processing" });
    assert.equal(state.queue.length, 1); assert.equal(state.notifications.length, 1); assert.equal(state.requests.length, 0);
}));

test("a saved decision with no email row can recover after a process interrupted enqueue", () => fixture(async ({ state, decide }) => {
    state.application.status = "verified";
    assert.deepEqual((await decide("verified")).body.email, { status: "queued" });
    assert.equal(state.queue.length, 1); assert.equal(state.notifications.length, 0); assert.equal(state.audits.length, 0);
}));

test.after(() => db.sequelize.close());
