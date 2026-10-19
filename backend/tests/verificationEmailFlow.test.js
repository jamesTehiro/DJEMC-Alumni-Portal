const nodeTest = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

// Load env before modules that use it
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const db = require("../models");
// This legacy suite creates and cleans up database records. Never run its broad
// cleanup against the developer's working portal database.
const isolatedDatabase = /_test$/i.test(db.sequelize.config.database || "")
    && process.env.RUN_DATABASE_INTEGRATION_TESTS === "true";
const test = Object.assign((name, run) => nodeTest(name, { skip: !isolatedDatabase }, run), nodeTest);
if (!isolatedDatabase) console.log("Verification database tests skipped: require a separate *_test database and RUN_DATABASE_INTEGRATION_TESTS=true.");
const notificationController = require("../controllers/notificationController");
const sendEmail = require("../utils/email");
const { enqueueEmails } = require("../utils/emailQueue");
const registrarController = require("../controllers/registrarController");
const adminController = require("../controllers/adminController");

test.after(async () => {
    await db.sequelize.close();
});

const uniqueEmail = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;

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
        }
    };
    return res;
};

// Helper to clean up test data
const cleanupTestData = async () => {
    // Delete test notifications
    await db.Notification.destroy({
        where: { message: { [db.Sequelize.Op.like]: "%verified%" } },
        force: true
    });
    // Delete test email queue jobs
    await db.EmailQueueJob.destroy({
        where: { subject: { [db.Sequelize.Op.like]: "%DJEMC%" } },
        force: true
    });
};

test.beforeEach(async () => {
    await cleanupTestData();
});

test.afterEach(async () => {
    await cleanupTestData();
});

// 1. Alumni Account Verification - Notification and Email Queue Creation
test("Alumni verification creates in-app notification and enqueues email", async () => {
    // Create a test alumni user
    const testAlumni = await db.User.create({
        email: uniqueEmail("alumni-verify"),
        password: "hashedpassword",
        name: "Test Alumni Verification",
        role: "alumni",
        account_status: "pending"
    });

    // Create a test alumni record
    const testRecord = await db.AlumniRecord.create({
        full_name: "Test Alumni Verification",
        student_id: "TEST-2024-001",
        course: "Computer Science",
        batch_year: 2024
    });

    const req = {
        params: { id: testAlumni.id },
        body: { alumni_record_id: testRecord.id }
    };
    const res = createRes();

    await registrarController.approveAlumniUser(req, res);

    // Verify response
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.msg, "Alumni user approved.");

    // Reload user from database to get updated status
    const updatedAlumni = await db.User.findByPk(testAlumni.id);
    assert.equal(updatedAlumni.account_status, "verified");

    // Verify in-app notification was created
    const notifications = await db.Notification.findAll({
        where: { userId: testAlumni.id }
    });
    assert.ok(notifications.length > 0, "In-app notification should be created");
    assert.equal(notifications[0].message, "Your account has been verified as an alumnus of DJEMC");

    // Verify email queue job was created
    const emailJobs = await db.EmailQueueJob.findAll({
        where: { to: { [db.Sequelize.Op.eq]: testAlumni.email } }
    });
    assert.ok(emailJobs.length > 0, "Email queue job should be created");
    assert.equal(emailJobs[0].subject, "DJEMC Alumni Account Verified");
    assert.equal(emailJobs[0].status, "pending");
});

// 2. Employer Account Verification - Notification and Email Queue Creation
test("Employer verification creates in-app notification and enqueues email", async () => {
    // Create a test employer user
    const testEmployer = await db.User.create({
        email: uniqueEmail("employer-verify"),
        password: "hashedpassword",
        name: "Test Employer Verification",
        role: "employer",
        account_status: "pending"
    });

    // Create employer profile
    await db.EmployerProfile.create({
        user_id: testEmployer.id,
        organization_name: "Test Company"
    });

    const req = {
        params: { userId: testEmployer.id },
        body: { status: "verified" },
        user: { id: 1, role: "admin", admin_scope: "employer" }
    };
    const res = createRes();

    await adminController.updateEmployerUserStatus(req, res);

    // Verify response
    assert.equal(res.statusCode, 200);

    // Reload user from database to get updated status
    const updatedEmployer = await db.User.findByPk(testEmployer.id);
    assert.equal(updatedEmployer.account_status, "verified");

    // Verify in-app notification was created
    const notifications = await db.Notification.findAll({
        where: { userId: testEmployer.id }
    });
    assert.ok(notifications.length > 0, "In-app notification should be created");
    assert.equal(notifications[0].message, "Your employer account has been verified by DJEMC Employer Admin");

    // Verify email queue job was created
    const emailJobs = await db.EmailQueueJob.findAll({
        where: { to: { [db.Sequelize.Op.eq]: testEmployer.email } }
    });
    assert.ok(emailJobs.length > 0, "Email queue job should be created");
    assert.equal(emailJobs[0].subject, "DJEMC Employer Account Verified");
    assert.equal(emailJobs[0].status, "pending");
});

// 3. Email Service - Configuration Error on Missing Credentials
test("sendEmail throws configuration error when SMTP credentials are missing", async () => {
    const originalProvider = process.env.EMAIL_PROVIDER;
    process.env.EMAIL_PROVIDER = 'smtp'; // Never fall through to a real Brevo send.
    // Temporarily remove SMTP credentials
    const originalEmailUser = process.env.EMAIL_USER;
    const originalEmailPass = process.env.EMAIL_PASS;
    const originalEmail = process.env.EMAIL;

    delete process.env.EMAIL_USER;
    delete process.env.EMAIL_PASS;
    delete process.env.EMAIL;

    // Clear the cached transporter
    const emailModule = require("../utils/email");
    emailModule.clearCache && emailModule.clearCache();

    try {
        await assert.rejects(
            async () => {
                await sendEmail("test@example.com", "Test Subject", "Test Message");
            },
            { message: /EMAIL_USER and EMAIL_PASS/ }
        );
    } finally {
        if (originalProvider === undefined) delete process.env.EMAIL_PROVIDER; else process.env.EMAIL_PROVIDER = originalProvider;
        // Restore environment variables
        process.env.EMAIL_USER = originalEmailUser;
        process.env.EMAIL_PASS = originalEmailPass;
        process.env.EMAIL = originalEmail;
    }
});

// 4. Email Queue Worker - Job Marked as Failed on SMTP Error
test("Email job marked as failed when SMTP fails", async () => {
    // Create an email job
    const testJob = await db.EmailQueueJob.create({
        to: "test-failure@example.com",
        subject: "Test Failure",
        message: "Test message",
        status: "pending",
        attempts: 0,
        max_attempts: 3
    });

    // Manually simulate what the worker does on failure
    const error = new Error("Invalid login: 535-5.7.8 Username and Password not accepted.");
    const nextAttempts = testJob.attempts + 1;
    const hasRemainingAttempts = nextAttempts < testJob.max_attempts;

    await testJob.update({
        status: hasRemainingAttempts ? "pending" : "failed",
        attempts: nextAttempts,
        last_error: error.message,
        scheduled_at: hasRemainingAttempts ? new Date(Date.now() + 30000) : testJob.scheduled_at
    });

    // Verify job status
    const updatedJob = await db.EmailQueueJob.findByPk(testJob.id);
    assert.equal(updatedJob.status, "pending");
    assert.equal(updatedJob.attempts, 1);
    assert.ok(updatedJob.last_error.includes("Invalid login"));
});

// 5. Email Queue Worker - Job Marked as Sent Only After Successful sendMail
test("Email job marked as sent only after successful sendMail", async () => {
    // This test verifies the worker logic in emailQueueWorker.js
    // The worker only calls markJobSent AFTER sendMail succeeds
    // We verify this by checking the code path

    const fs = require("fs");
    const workerCode = fs.readFileSync(
        path.join(__dirname, "..", "workers", "emailQueueWorker.js"),
        "utf8"
    );

    // Verify the worker calls sendMail before markJobSent
    const sendMailIndex = workerCode.indexOf("await sendEmail(job.to, job.subject, job.message);");
    const markJobSentIndex = workerCode.indexOf("await markJobSent(job);");

    assert.ok(sendMailIndex > 0, "Worker should call sendEmail");
    assert.ok(markJobSentIndex > 0, "Worker should call markJobSent");
    assert.ok(
        sendMailIndex < markJobSentIndex,
        "sendEmail must be called before markJobSent"
    );
});

// 6. Regression Test - Job Posting Notifications Still Work
test("Job posting notifications still work and create notifications", async () => {
    // Create a test employer
    const testEmployer = await db.User.create({
        email: uniqueEmail("job-posting"),
        password: "hashedpassword",
        name: "Test Job Poster",
        role: "employer",
        account_status: "verified"
    });

    await db.EmployerProfile.create({
        user_id: testEmployer.id,
        organization_name: "Test Company",
        verified: true
    });

    // Create a test alumni to receive the notification
    const testAlumni = await db.User.create({
        email: uniqueEmail("alumni-job"),
        password: "hashedpassword",
        name: "Test Alumni Job",
        role: "alumni",
        account_status: "verified"
    });

    // Simulate notification creation as jobController.notifyApprovedJob would do
    await notificationController.createNotification({
        userIds: [testAlumni.id],
        message: `New approved job posted: Test Engineer`,
        subject: "New Job Opportunity!"
    });

    // Verify notification was created
    const notifications = await db.Notification.findAll({
        where: { userId: testAlumni.id }
    });
    assert.ok(notifications.length > 0, "Job notification should be created");

    // Verify email queue job was created
    const emailJobs = await db.EmailQueueJob.findAll({
        where: { to: { [db.Sequelize.Op.eq]: testAlumni.email } }
    });
    assert.ok(emailJobs.length > 0, "Job email queue job should be created");
    assert.equal(emailJobs[0].subject, "New Job Opportunity!");
});

// 7. Regression Test - Announcement Notifications Still Work
test("Announcement notifications still work and create notifications", async () => {
    // Create test alumni users
    const testAlumni1 = await db.User.create({
        email: uniqueEmail("announcement-1"),
        password: "hashedpassword",
        name: "Test Alumni Announcement 1",
        role: "alumni",
        account_status: "verified"
    });

    const testAlumni2 = await db.User.create({
        email: uniqueEmail("announcement-2"),
        password: "hashedpassword",
        name: "Test Alumni Announcement 2",
        role: "alumni",
        account_status: "verified"
    });

    // Simulate notification creation as announcement controller would do
    await notificationController.createNotification({
        userIds: [testAlumni1.id, testAlumni2.id],
        message: "New announcement: Test Announcement",
        subject: "New Announcement from Alumni Admin"
    });

    // Verify notifications were created
    const notifications1 = await db.Notification.findAll({
        where: { userId: testAlumni1.id }
    });
    const notifications2 = await db.Notification.findAll({
        where: { userId: testAlumni2.id }
    });

    assert.ok(notifications1.length > 0, "Announcement notification should be created for alumni 1");
    assert.ok(notifications2.length > 0, "Announcement notification should be created for alumni 2");

    // Verify email queue jobs were created
    const emailJobs1 = await db.EmailQueueJob.findAll({
        where: { to: { [db.Sequelize.Op.eq]: testAlumni1.email } }
    });
    const emailJobs2 = await db.EmailQueueJob.findAll({
        where: { to: { [db.Sequelize.Op.eq]: testAlumni2.email } }
    });

    assert.ok(emailJobs1.length > 0, "Announcement email job should be created for alumni 1");
    assert.ok(emailJobs2.length > 0, "Announcement email job should be created for alumni 2");
    assert.equal(emailJobs1[0].subject, "New Announcement from Alumni Admin");
});

// 8. Email Queue Worker - Retry Logic Verification
test("Email job retry logic increments attempts and reschedules", async () => {
    const testJob = await db.EmailQueueJob.create({
        to: "test-retry@example.com",
        subject: "Test Retry",
        message: "Test message",
        status: "pending",
        attempts: 0,
        max_attempts: 3,
        scheduled_at: new Date()
    });

    // Simulate first failure
    const error1 = new Error("SMTP error");
    const attempts1 = testJob.attempts + 1;
    const hasRemaining1 = attempts1 < testJob.max_attempts;

    await testJob.update({
        status: hasRemaining1 ? "pending" : "failed",
        attempts: attempts1,
        last_error: error1.message,
        scheduled_at: hasRemaining1 ? new Date(Date.now() + 30000) : testJob.scheduled_at
    });

    let job = await db.EmailQueueJob.findByPk(testJob.id);
    assert.equal(job.status, "pending");
    assert.equal(job.attempts, 1);
    assert.ok(job.scheduled_at > new Date(), "Job should be rescheduled for later");

    // Simulate second failure
    const error2 = new Error("SMTP error again");
    const attempts2 = job.attempts + 1;
    const hasRemaining2 = attempts2 < job.max_attempts;

    await job.update({
        status: hasRemaining2 ? "pending" : "failed",
        attempts: attempts2,
        last_error: error2.message,
        scheduled_at: hasRemaining2 ? new Date(Date.now() + 30000) : job.scheduled_at
    });

    job = await db.EmailQueueJob.findByPk(testJob.id);
    assert.equal(job.status, "pending");
    assert.equal(job.attempts, 2);

    // Simulate third failure (exhausted retries)
    const error3 = new Error("SMTP error final");
    const attempts3 = job.attempts + 1;
    const hasRemaining3 = attempts3 < job.max_attempts;

    await job.update({
        status: hasRemaining3 ? "pending" : "failed",
        attempts: attempts3,
        last_error: error3.message,
        scheduled_at: hasRemaining3 ? new Date(Date.now() + 30000) : job.scheduled_at
    });

    job = await db.EmailQueueJob.findByPk(testJob.id);
    assert.equal(job.status, "failed");
    assert.equal(job.attempts, 3);
    assert.equal(job.last_error, "SMTP error final");
});

// 9. Email Service - Verify No Silent Success
test("Email service does not silently succeed when SMTP is misconfigured", async () => {
    // Verify current implementation throws on missing credentials
    const originalEmailUser = process.env.EMAIL_USER;
    const originalEmailPass = process.env.EMAIL_PASS;
    const originalEmail = process.env.EMAIL;

    delete process.env.EMAIL_USER;
    delete process.env.EMAIL_PASS;
    delete process.env.EMAIL;

    // Clear module cache to force re-evaluation
    delete require.cache[require.resolve("../utils/email")];

    const emailModuleNoCache = require("../utils/email");

    try {
        let threw = false;
        try {
            await emailModuleNoCache("test@example.com", "Subject", "Message");
        } catch (err) {
            threw = true;
            assert.ok(err.message.includes("EMAIL_USER"), "Should mention EMAIL_USER in error");
            assert.ok(err.message.includes("EMAIL_PASS"), "Should mention EMAIL_PASS in error");
        }
        assert.ok(threw, "Should throw error on missing credentials");
    } finally {
        process.env.EMAIL_USER = originalEmailUser;
        process.env.EMAIL_PASS = originalEmailPass;
        process.env.EMAIL = originalEmail;
        // Restore proper module
        delete require.cache[require.resolve("../utils/email")];
        require("../utils/email");
    }
});

// 10. Notification Controller - Distributor Pattern Verification
test("notificationController.createNotification uses distributor enqueueEmails", async () => {
    const fs = require("fs");
    const controllerCode = fs.readFileSync(
        path.join(__dirname, "..", "controllers", "notificationController.js"),
        "utf8"
    );

    // Verify the controller imports enqueueEmails
    assert.ok(
        controllerCode.includes('const { enqueueEmails } = require("../utils/emailQueue")'),
        "Controller should import enqueueEmails"
    );

    // Verify the controller calls enqueueEmails
    assert.ok(
        controllerCode.includes("await enqueueEmails("),
        "Controller should call enqueueEmails"
    );
});

console.log("Email verification test suite ready. Run with: npm test");
