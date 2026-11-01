const db = require("../models");
const { enqueueEmails } = require("./emailQueue");
const { safeEmailError } = require("./emailDiagnostics");
const { isGmail, normalizeEmail } = require("./registrationEmail");

const portalName = "DJEMC Alumni Tracking and Job Portal System";
const portalUrl = "https://djemc-alumni-portal.web.app";
const eventTypes = { verified: "job_application_approved", not_verified: "job_application_declined" };
const line = value => typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim() : "";

// The existing queue stores plain text and Brevo sends it as textContent.
// Dynamic values never enter HTML, document attachments or employer notes.
const buildApplicationDecisionEmail = ({ status, applicantName, jobTitle, companyName, updatedAt }) => {
    if (!eventTypes[status]) throw new Error("Unsupported application decision email.");
    const approved = status === "verified";
    const name = line(applicantName) || "Applicant";
    const title = line(jobTitle) || "the advertised position";
    const company = line(companyName) || "the hiring organization";
    const date = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", year: "numeric", month: "long", day: "numeric" }).format(updatedAt);
    const subject = approved ? "Job Application Update – Application Approved" : `Job Application Update – ${title}`;
    const introduction = approved
        ? `We are pleased to inform you that your application for the position of ${title} at ${company} has been approved for the next stage of the recruitment process.\n\n` +
          `You may log in to the ${portalName} to review your application status and check for further updates or instructions from the employer.`
        : `Thank you for your interest in the ${title} position at ${company} and for taking the time to submit your application.\n\n` +
          "After reviewing your application, we regret to inform you that your application has not been selected to proceed to the next stage of the recruitment process.\n\n" +
          `We appreciate your interest and encourage you to explore other employment opportunities available through the ${portalName}.`;
    return {
        subject: Array.from(subject).slice(0, 255).join(""),
        message: `Dear ${name},\n\n${introduction}\n\nApplication Details:\n` +
            `- Applicant: ${name}\n- Position Applied For: ${title}\n- Company / Organization: ${company}\n` +
            `- Application Status: ${approved ? "Approved" : "Declined"}\n- Date Updated: ${date} (Philippine Time)\n\n` +
            `Log in: ${portalUrl}\n\n` +
            (approved ? `Thank you for using the ${portalName}.` : "We wish you success in your future career opportunities.") +
            `\n\nBest regards,\n\n${portalName}\nDon Jose Ecleo Memorial College`
    };
};

const queueApplicationDecisionEmail = async ({ applicationId, alumniId, recruitmentCycle, status, job, updatedAt }) => {
    const event = eventTypes[status];
    if (!event) return;
    const context = { applicationId, recruitmentCycle, event };
    try {
        // Use the registered account, never request-body or application-form email.
        const applicant = await db.User.findByPk(alumniId, { attributes: ["id", "name", "email", "role", "account_status", "email_verified_at"] });
        const verifiedAt = applicant?.email_verified_at;
        if (applicant?.role !== "alumni" || applicant.account_status !== "verified" || !verifiedAt || !Number.isFinite(new Date(verifiedAt).getTime())) {
            console.warn("[application-decision-email] skipped", { ...context, reason: "recipient_not_verified" });
            return;
        }
        if (!isGmail(applicant.email) || /[\r\n\u0000]/.test(applicant.email)) {
            console.warn("[application-decision-email] skipped", { ...context, reason: "invalid_registered_email" });
            return;
        }
        const owner = await db.User.findByPk(job.employer_id, {
            attributes: ["id", "name"], include: [{ model: db.EmployerProfile, attributes: ["organization_name"] }]
        });
        const content = buildApplicationDecisionEmail({ status, applicantName: applicant.name, jobTitle: job.title,
            companyName: owner?.EmployerProfile?.organization_name || owner?.name, updatedAt });
        const queued = await enqueueEmails([{
            to: normalizeEmail(applicant.email), ...content,
            dedupe_key: `job-application-decision:${applicationId}:${recruitmentCycle}:${status}`
        }]);
        // enqueueEmails already logs sanitized database errors. Add the event ID
        // for investigation without logging the address, template or raw error.
        if (!queued?.length) console.error("[application-decision-email] enqueue failed", { ...context, code: "EMAIL_ERROR" });
    } catch (error) {
        console.error("[application-decision-email] enqueue failed", { ...context, ...safeEmailError(error) });
    }
};

module.exports = { buildApplicationDecisionEmail, queueApplicationDecisionEmail };
