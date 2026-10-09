/**
 * NOTIFICATION PIPELINE DIAGNOSTIC SCRIPT
 * 
 * This script checks the database state to diagnose why job postings
 * are not creating notifications or email queue entries.
 * 
 * Run: node backend/diagnose_notifications.js
 */

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const db = require("./models");

async function diagnose() {
    console.log("\n========== NOTIFICATION PIPELINE DIAGNOSTIC ==========\n");

    try {
        await db.sequelize.authenticate();
        console.log("[OK] Database connection established.\n");
    } catch (err) {
        console.error("[FAIL] Database connection failed:", err.message);
        process.exit(1);
    }

    const queryInterface = db.sequelize.getQueryInterface();

    // =========================================================
    // STEP 1: Tables existence check
    // =========================================================
    console.log("--- STEP 1: Table Existence ---");
    const tables = await queryInterface.showAllTables();
    const tableNames = tables.map(t => t.toLowerCase());

    const requiredTables = ["notifications", "email_queue_jobs", "users", "jobs", "alumniprofiles", "employerprofiles"];
    for (const table of requiredTables) {
        console.log(`  [${tableNames.includes(table) ? "OK" : "MISSING"}] ${table}`);
    }
    console.log();

    // =========================================================
    // STEP 2: User counts by role
    // =========================================================
    console.log("--- STEP 2: User Counts ---");
    const totalUsers = await db.User.count();
    const alumniCount = await db.User.count({ where: { role: "alumni" } });
    const verifiedAlumniCount = await db.User.count({ where: { role: "alumni", account_status: "verified" } });
    const pendingAlumniCount = await db.User.count({ where: { role: "alumni", account_status: "pending" } });
    const employerCount = await db.User.count({ where: { role: "employer" } });
    const verifiedEmployerCount = await db.User.count({ where: { role: "employer", account_status: "verified" } });

    console.log(`  Total users: ${totalUsers}`);
    console.log(`  Alumni (total): ${alumniCount}`);
    console.log(`  Alumni (verified): ${verifiedAlumniCount}`);
    console.log(`  Alumni (pending): ${pendingAlumniCount}`);
    console.log(`  Employers (total): ${employerCount}`);
    console.log(`  Employers (verified): ${verifiedEmployerCount}`);
    console.log();

    // =========================================================
    // STEP 3: Check alumni account_statuses
    // =========================================================
    console.log("--- STEP 3: Alumni Account Status Breakdown ---");
    const statusBreakdown = await db.User.findAll({
        where: { role: "alumni" },
        attributes: ["account_status", [db.Sequelize.fn("COUNT", db.Sequelize.col("id")), "count"]],
        group: ["account_status"]
    });
    if (statusBreakdown.length === 0) {
        console.log("  No alumni users found.");
    } else {
        for (const s of statusBreakdown) {
            console.log(`  ${s.account_status}: ${s.getDataValue("count")}`);
        }
    }
    console.log();

    // =========================================================
    // STEP 4: Check alumni profiles - course distribution
    // =========================================================
    console.log("--- STEP 4: Alumni Profile Course Distribution ---");
    const courseCounts = await db.AlumniProfile.findAll({
        attributes: ["course", [db.Sequelize.fn("COUNT", db.Sequelize.col("user_id")), "count"]],
        group: ["course"]
    });
    if (courseCounts.length === 0) {
        console.log("  No alumni profiles found.");
    } else {
        for (const c of courseCounts) {
            console.log(`  Course "${c.course || 'NULL'}": ${c.getDataValue("count")} alumni`);
        }
    }
    console.log();

    // =========================================================
    // STEP 5: Check recent jobs
    // =========================================================
    console.log("--- STEP 5: Recent Jobs ---");
    const recentJobs = await db.Job.findAll({
        order: [["createdAt", "DESC"]],
        limit: 10,
        include: [{ model: db.User, attributes: ["id", "name", "email", "role"] }]
    });
    if (recentJobs.length === 0) {
        console.log("  No jobs found.");
    } else {
        for (const j of recentJobs) {
            const employer = j.User;
            console.log(`  Job ID: ${j.id}, Title: "${j.title}"`);
            console.log(`    Employer ID: ${j.employer_id}, Name: ${employer?.name || 'N/A'}`);
            console.log(`    Recruitment Status: ${j.recruitment_status}`);
            console.log(`    Course Target: ${j.course_target || 'None (all alumni)'}`);
            console.log(`    Created: ${j.createdAt}`);
            console.log();
        }
    }

    // =========================================================
    // STEP 6: Check notifications table
    // =========================================================
    console.log("--- STEP 6: Notifications Table ---");
    const notifCount = await db.Notification.count();
    const jobNotifCount = await db.Notification.count({ where: { type: "job_posting" } });
    console.log(`  Total notifications: ${notifCount}`);
    console.log(`  Job posting notifications: ${jobNotifCount}`);

    if (jobNotifCount > 0) {
        const recentNotifs = await db.Notification.findAll({
            where: { type: "job_posting" },
            order: [["createdAt", "DESC"]],
            limit: 5
        });
        console.log(`  Recent job notifications:`);
        for (const n of recentNotifs) {
            console.log(`    ID: ${n.id}, UserID: ${n.userId}, Created: ${n.createdAt}`);
        }
    }
    console.log();

    // =========================================================
    // STEP 7: Check email_queue_jobs table
    // =========================================================
    console.log("--- STEP 7: Email Queue Jobs ---");
    const emailQueueCount = await db.EmailQueueJob.count();
    console.log(`  Total email queue jobs: ${emailQueueCount}`);

    if (emailQueueCount > 0) {
        const statuses = await db.EmailQueueJob.findAll({
            attributes: ["status", [db.Sequelize.fn("COUNT", db.Sequelize.col("id")), "count"]],
            group: ["status"]
        });
        console.log("  Status breakdown:");
        for (const s of statuses) {
            console.log(`    ${s.status}: ${s.getDataValue("count")}`);
        }

        const recentEmails = await db.EmailQueueJob.findAll({
            order: [["createdAt", "DESC"]],
            limit: 5
        });
        console.log("  Recent email queue jobs:");
        for (const e of recentEmails) {
            console.log(`    ID: ${e.id}, To: ${e.to}, Subject: "${e.subject}", Status: ${e.status}, Attempts: ${e.attempts}`);
        }
    }
    console.log();

    // =========================================================
    // STEP 8: Simulate what createJob does (eligibility check)
    // =========================================================
    console.log("--- STEP 8: Simulated Eligibility Check ---");

    // Check what createJob's query returns
    const alumniWhere = { role: "alumni", account_status: "verified" };
    const alumniInclude = [];

    const allEligibleAlumni = await db.User.findAll({
        where: alumniWhere,
        include: alumniInclude,
        attributes: ["id", "name", "email"]
    });
    console.log(`  Verified alumni (unfiltered): ${allEligibleAlumni.length}`);
    if (allEligibleAlumni.length > 0) {
        console.log(`  First 5 verified alumni IDs: ${allEligibleAlumni.slice(0, 5).map(u => u.id).join(", ")}`);
        console.log(`  First 5 verified alumni emails: ${allEligibleAlumni.slice(0, 5).map(u => u.email).join(", ")}`);
    }

    // Check for each recent job what would happen
    if (recentJobs.length > 0) {
        console.log();
        for (const j of recentJobs) {
            const localInclude = [];
            if (j.course_target) {
                localInclude.push({
                    model: db.AlumniProfile,
                    where: { course: j.course_target },
                    attributes: []
                });
            }
            const eligibleAlumni = await db.User.findAll({
                where: { role: "alumni", account_status: "verified" },
                include: localInclude,
                attributes: ["id"]
            });
            console.log(`  Job "${j.title}" (course_target: ${j.course_target || 'none'}): ${eligibleAlumni.length} eligible alumni`);
        }
    }

    // =========================================================
    // SUMMARY & ROOT CAUSE ANALYSIS
    // =========================================================
    console.log("\n========== SUMMARY ==========\n");

    console.log("Notification Pipeline Diagnosis:");
    console.log(`  Verified alumni eligible for notifications: ${verifiedAlumniCount}`);
    console.log(`  Notifications in DB (job_posting type): ${jobNotifCount}`);
    console.log(`  Email queue jobs in DB: ${emailQueueCount}`);

    if (verifiedAlumniCount === 0) {
        console.log("\n[ROOT CAUSE 1] No verified alumni users exist in the database.");
        console.log("  Create at least one alumni user with account_status='verified' to receive notifications.");
    }

    if (jobNotifCount === 0 && verifiedAlumniCount > 0) {
        console.log("\n[ROOT CAUSE 2] No job_posting notifications found despite having verified alumni.");
        console.log("  The notification creation code in createJob() may not be executing.");
        console.log("  Check the server logs when posting a job for [DEBUG] messages.");
    }

    if (emailQueueCount === 0 && jobNotifCount > 0) {
        console.log("\n[ROOT CAUSE 3] Job notifications exist but email queue is empty.");
        console.log("  The enqueueEmails() call in notificationController may be failing silently.");
    }

    if (emailQueueCount > 0) {
        const sentCount = await db.EmailQueueJob.count({ where: { status: "sent" } });
        const failedCount = await db.EmailQueueJob.count({ where: { status: "failed" } });
        console.log(`  Sent: ${sentCount}, Failed: ${failedCount}`);

        if (failedCount > 0) {
            console.log("\n[ROOT CAUSE 4] Some email jobs have failed. Check last_error field.");
            const failedJobs = await db.EmailQueueJob.findAll({
                where: { status: "failed" },
                limit: 3
            });
            for (const f of failedJobs) {
                console.log(`  Failed job ID ${f.id} to ${f.to}: ${f.last_error}`);
            }
        }
    }

    await db.sequelize.close();
    console.log("\n========== DIAGNOSTIC COMPLETE ==========\n");
}

diagnose().catch(err => {
    console.error("Diagnostic error:", err);
    process.exit(1);
});

