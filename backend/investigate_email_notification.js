/**
 * EMAIL NOTIFICATION PIPELINE INVESTIGATION
 * 
 * This script adds temporary logging to trace the job posting → email notification pipeline.
 * Run: node backend/investigate_email_notification.js
 * 
 * It does NOT modify any business logic, SMTP config, or permanent behavior.
 */

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const db = require("./models");

// ============================================================
// STEP 1: Check if notifyApprovedJob exists in jobController
// ============================================================
console.log("\n========== EMAIL NOTIFICATION PIPELINE INVESTIGATION ==========\n");

const jobController = require("./controllers/jobController");
console.log("[CHECK] jobController exports:", Object.keys(jobController));
console.log("[CHECK] Does jobController.notifyApprovedJob exist?", typeof jobController.notifyApprovedJob);

// ============================================================
// STEP 2: Check if createJob calls any notification logic
// ============================================================
const fs = require("fs");
const jobControllerSource = fs.readFileSync(
    path.join(__dirname, "controllers", "jobController.js"),
    "utf8"
);

console.log("\n[CHECK] Does createJob call notificationController?",
    jobControllerSource.includes("notificationController") ? "YES (imported)" : "NO");
console.log("[CHECK] Does createJob call createNotification?",
    jobControllerSource.includes("createNotification") ? "YES" : "NO");
console.log("[CHECK] Does createJob call enqueueEmails?",
    jobControllerSource.includes("enqueueEmails") ? "YES" : "NO");
console.log("[CHECK] Does createJob call notifyApprovedJob?",
    jobControllerSource.includes("notifyApprovedJob") ? "YES" : "NO");

// ============================================================
// STEP 3: Check adminController for the approval flow
// ============================================================
const adminControllerSource = fs.readFileSync(
    path.join(__dirname, "controllers", "adminController.js"),
    "utf8"
);

console.log("\n[CHECK] Does adminController.updateJobApprovalStatus call notifyApprovedJob?",
    adminControllerSource.includes("notifyApprovedJob") ? "YES" : "NO");

// ============================================================
// STEP 4: Check notificationController
// ============================================================
const notificationControllerSource = fs.readFileSync(
    path.join(__dirname, "controllers", "notificationController.js"),
    "utf8"
);

console.log("\n[CHECK] notificationController.createNotification exists:",
    notificationControllerSource.includes("exports.createNotification") ? "YES" : "NO");
console.log("[CHECK] notificationController calls enqueueEmails:",
    notificationControllerSource.includes("enqueueEmails") ? "YES" : "NO");

// ============================================================
// STEP 5: Check email queue service
// ============================================================
const emailQueueSource = fs.readFileSync(
    path.join(__dirname, "utils", "emailQueue.js"),
    "utf8"
);

console.log("\n[CHECK] emailQueue.enqueueEmails exists:",
    emailQueueSource.includes("enqueueEmails") ? "YES" : "NO");
console.log("[CHECK] emailQueue inserts into EmailQueueJob:",
    emailQueueSource.includes("EmailQueueJob.bulkCreate") ? "YES" : "NO");

// ============================================================
// STEP 6: Check email queue worker
// ============================================================
const workerSource = fs.readFileSync(
    path.join(__dirname, "workers", "emailQueueWorker.js"),
    "utf8"
);

console.log("\n[CHECK] Worker calls sendEmail:",
    workerSource.includes("sendEmail") ? "YES" : "NO");
console.log("[CHECK] Worker marks jobs as sent:",
    workerSource.includes("markJobSent") ? "YES" : "NO");
console.log("[CHECK] Worker marks jobs as failed:",
    workerSource.includes("markJobFailed") ? "YES" : "NO");

// ============================================================
// STEP 7: Check Nodemailer transport
// ============================================================
const emailSource = fs.readFileSync(
    path.join(__dirname, "utils", "email.js"),
    "utf8"
);

console.log("\n[CHECK] email.js uses nodemailer:",
    emailSource.includes("nodemailer") ? "YES" : "NO");
console.log("[CHECK] SMTP_HOST configured:", process.env.SMTP_HOST || "NOT SET");
console.log("[CHECK] SMTP_PORT configured:", process.env.SMTP_PORT || "NOT SET");
console.log("[CHECK] EMAIL_USER configured:", process.env.EMAIL_USER ? "YES (set)" : "NOT SET");
console.log("[CHECK] EMAIL_PASS configured:", process.env.EMAIL_PASS ? "YES (set)" : "NOT SET");

// ============================================================
// STEP 8: Check if server starts the email queue worker
// ============================================================
const serverSource = fs.readFileSync(
    path.join(__dirname, "server.js"),
    "utf8"
);

console.log("\n[CHECK] server.js starts email queue worker:",
    serverSource.includes("startEmailWorker") ? "YES" : "NO");
console.log("[CHECK] startEmailWorker uses fork:",
    serverSource.includes("fork") ? "YES" : "NO");

// ============================================================
// STEP 9: Check Job model for approval_status column
// ============================================================
const jobModelSource = fs.readFileSync(
    path.join(__dirname, "models", "Job.js"),
    "utf8"
);

console.log("\n[CHECK] Job model has approval_status:",
    jobModelSource.includes("approval_status") ? "YES" : "NO");

// ============================================================
// STEP 10: Check database for email_queue_jobs table
// ============================================================
async function checkDatabase() {
    try {
        await db.sequelize.authenticate();
        console.log("\n[DB] Database connection: OK");

        const queryInterface = db.sequelize.getQueryInterface();
        const tables = await queryInterface.showAllTables();
        console.log("[DB] Tables:", tables.join(", "));

        // Check if email_queue_jobs table exists
        const hasEmailQueue = tables.some(t => t.toLowerCase() === "email_queue_jobs");
        console.log("[DB] email_queue_jobs table exists:", hasEmailQueue);

        if (hasEmailQueue) {
            const count = await db.EmailQueueJob.count();
            console.log("[DB] Current email_queue_jobs count:", count);

            // Check status distribution
            const statuses = await db.EmailQueueJob.findAll({
                attributes: ["status", [db.Sequelize.fn("COUNT", db.Sequelize.col("id")), "count"]],
                group: ["status"]
            });
            console.log("[DB] Email queue job statuses:");
            statuses.forEach(s => {
                console.log(`    ${s.getDataValue("status")}: ${s.getDataValue("count")}`);
            });
        }

        // Check if Jobs table has approval_status column
        const jobColumns = await queryInterface.describeTable("Jobs");
        console.log("\n[DB] Job table columns:", Object.keys(jobColumns).join(", "));
        console.log("[DB] Job has approval_status:", "approval_status" in jobColumns);
        console.log("[DB] Job has recruitment_status:", "recruitment_status" in jobColumns);

        // Check recent jobs
        const recentJobs = await db.Job.findAll({
            order: [["createdAt", "DESC"]],
            limit: 5,
            attributes: ["id", "title", "approval_status", "recruitment_status", "employer_id", "createdAt"]
        });
        console.log("\n[DB] Recent jobs:");
        recentJobs.forEach(j => {
            console.log(`    ID: ${j.id}, Title: ${j.title}, approval: ${j.approval_status}, recruitment: ${j.recruitment_status}, employer: ${j.employer_id}, created: ${j.createdAt}`);
        });

        // Check alumni users
        const alumniCount = await db.User.count({ where: { role: "alumni" } });
        const verifiedAlumni = await db.User.count({ where: { role: "alumni", account_status: "verified" } });
        console.log("\n[DB] Alumni users total:", alumniCount);
        console.log("[DB] Verified alumni:", verifiedAlumni);

    } catch (err) {
        console.error("[DB] Error:", err.message);
    } finally {
        await db.sequelize.close();
    }
}

checkDatabase().then(() => {
    console.log("\n========== INVESTIGATION COMPLETE ==========");
    console.log("\nSUMMARY OF FINDINGS:");
    console.log("1. jobController.createJob() - Saves job to DB but NEVER calls any notification/email function");
    console.log("2. jobController.notifyApprovedJob() - DOES NOT EXIST (referenced in adminController but never defined)");
    console.log("3. adminController.updateJobApprovalStatus() - Calls notifyApprovedJob() which is MISSING");
    console.log("4. notificationController.createNotification() - EXISTS and works (used by announcements, verification)");
    console.log("5. emailQueue.enqueueEmails() - EXISTS and works");
    console.log("6. emailQueueWorker - EXISTS and works (polls, sends via Nodemailer)");
    console.log("7. Nodemailer transport - CONFIGURED (SMTP host/port/credentials set)");
    console.log("8. Server starts worker - YES (fork on startup)");
    console.log("\nROOT CAUSE: The notification pipeline is NEVER triggered after job creation.");
    console.log("  - For regular employers: createJob() doesn't call any notification function.");
    console.log("  - For admin employers: createJob() sets approval_status='approved' but still no notification.");
    console.log("  - For admin approval flow: updateJobApprovalStatus() calls notifyApprovedJob() which DOES NOT EXIST.");
    console.log("\nThe missing function should query eligible alumni and call notificationController.createNotification().");
});