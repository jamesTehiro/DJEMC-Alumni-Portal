const db = require("../models");
const notificationController = require("./notificationController");
const { enqueueEmails } = require("../utils/emailQueue");
const jobController = require("./jobController");
const { parseTargetGraduationYear, graduationYearWhere } = require("../utils/targetGraduationYear");
const auditService = require("../services/auditService");

const normalizeAccountStatus = (status) => String(status || "").toLowerCase();
const allowedAccountStatuses = ["pending", "verified", "suspended", "rejected", "deactivated"];

const normalizeJobStatus = (status) => String(status || "").toLowerCase();
const allowedJobStatuses = ["pending", "approved", "rejected"];

// ALUMNI ADMIN
exports.getAlumniUsers = async (req, res) => {
    try {
        const users = await db.User.findAll({
            where: { role: "alumni" },
            attributes: ["id", "name", "email", "role", "account_status", "createdAt"],
            include: [
                {
                    model: db.AlumniProfile,
                    attributes: ["course", "major", "graduation_year", "avatar_url", "employment_status", "job_title", "address", "profile_visibility", "current_company", "updatedAt"]
                },
                { model: db.AlumniRecord, as: "AlumniRecord", attributes: ["id", "full_name", "course", "major", "batch_year"] }
            ],
            order: [["createdAt", "DESC"]]
        });

        const requests = users.length
            ? await db.AlumniProfileUpdateRequest.findAll({
                where: { alumni_user_id: users.map((user) => user.id) },
                attributes: ["id", "alumni_user_id", "status", "createdAt", "sent_at", "responded_at", "completed_at"],
                order: [["createdAt", "DESC"]]
            })
            : [];
        const latestRequestByUser = new Map();
        requests.forEach((request) => {
            if (!latestRequestByUser.has(Number(request.alumni_user_id))) {
                latestRequestByUser.set(Number(request.alumni_user_id), request);
            }
        });
        res.json(users.map((user) => ({
            ...user.toJSON(),
            latestProfileUpdateRequest: latestRequestByUser.get(Number(user.id)) || null
        })));
    } catch (err) {
        res.status(500).json({ msg: err.message });
    }
};

exports.getAlumniTrackingSummary = async (_req, res) => {
    try {
        const masterRecords = await db.AlumniRecord.findAll({
            attributes: ["id"],
            include: [{
                model: db.User,
                required: false,
                attributes: ["id"],
                include: [{ model: db.AlumniProfile, required: false, attributes: ["employment_status"] }]
            }]
        });
        const statuses = masterRecords
            .map((record) => String(record.User?.AlumniProfile?.employment_status || "").trim().toLowerCase().replace(/[_\s]+/g, "-"));
        return res.json({
            totalGraduates: masterRecords.length,
            employed: statuses.filter((status) => status === "employed").length,
            unemployed: statuses.filter((status) => status === "unemployed").length,
            selfEmployed: statuses.filter((status) => status === "self-employed").length
        });
    } catch (err) {
        return res.status(500).json({ msg: err.message });
    }
};

exports.getAlumniTrackingDetails = async (req, res) => {
    try {
        const alumniId = Number(req.params.userId);
        if (!Number.isInteger(alumniId) || alumniId <= 0) return res.status(400).json({ msg: "Invalid alumni user ID." });

        const alumni = await db.User.findOne({
            where: { id: alumniId, role: "alumni" },
            attributes: ["id", "name", "role", "account_status", "updatedAt"],
            include: [
                {
                    model: db.AlumniProfile,
                    attributes: ["course", "major", "graduation_year", "avatar_url", "profile_visibility", "employment_status", "current_company", "job_title", "updatedAt"],
                    include: [{ model: db.EmploymentHistory, attributes: ["id", "company_name", "position", "start_year", "end_year", "employment_type"] }]
                },
                { model: db.AlumniRecord, as: "AlumniRecord", attributes: ["id", "full_name", "course", "major", "batch_year"] }
            ]
        });
        if (!alumni) return res.status(404).json({ msg: "Alumni account not found." });

        const profile = alumni.AlumniProfile;
        if (profile && String(profile.profile_visibility || "public").toLowerCase() !== "public") {
            profile.current_company = null;
            profile.job_title = null;
            profile.EmploymentHistories = [];
        } else if (profile?.EmploymentHistories) {
            profile.EmploymentHistories.sort((a, b) => Number(b.start_year || 0) - Number(a.start_year || 0));
        }

        const [requests, events] = await Promise.all([
            db.AlumniProfileUpdateRequest.findAll({
                where: { alumni_user_id: alumniId },
                include: [
                    { model: db.User, as: "requester", attributes: ["id", "name", "role"] },
                    { model: db.EmailQueueJob, as: "emailQueueJob", attributes: ["id", "status", "sent_at"] }
                ],
                order: [["createdAt", "DESC"]]
            }),
            db.AuditLog.findAll({
                where: {
                    target_type: "alumni",
                    target_id: alumniId,
                    action: { [db.Sequelize.Op.in]: [
                        "alumni.profile_update.requested",
                        "alumni.profile_update.responded",
                        "alumni.profile.updated",
                        "alumni.account_status.changed"
                    ] }
                },
                attributes: ["id", "actor_id", "actor_role", "action", "metadata", "created_at"],
                include: [{ model: db.User, attributes: ["id", "name", "role"] }],
                order: [["created_at", "DESC"]],
                limit: 100
            })
        ]);

        return res.json({ alumni, requests, events });
    } catch (err) {
        return res.status(500).json({ msg: err.message });
    }
};

exports.requestAlumniProfileUpdate = async (req, res) => {
    try {
        const alumniId = Number(req.params.userId);
        if (!Number.isInteger(alumniId) || alumniId <= 0) return res.status(400).json({ msg: "Invalid alumni user ID." });
        const cooldownStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const requestMessage = "Hello, DJEMC Alumni!\n\nWould you like to update your educational background, employment status, or career progress? You may review and update your profile anytime through your Alumni Portal.\n\nThank you for staying connected with DJEMC!";

        const result = await db.sequelize.transaction(async (transaction) => {
            const alumni = await db.User.findOne({
                where: { id: alumniId, role: "alumni" },
                attributes: ["id", "name", "email", "account_status"],
                transaction,
                lock: transaction.LOCK.UPDATE
            });
            if (!alumni) {
                const err = new Error("Alumni account not found."); err.status = 404; throw err;
            }

            const activeRequest = await db.AlumniProfileUpdateRequest.findOne({
                where: { alumni_user_id: alumniId, status: { [db.Sequelize.Op.in]: ["pending", "sent", "responded"] } },
                order: [["createdAt", "DESC"]], transaction, lock: transaction.LOCK.UPDATE
            });
            if (activeRequest) {
                const err = new Error("A profile update request is already active for this alumnus."); err.status = 409; throw err;
            }

            const recentRequest = await db.AlumniProfileUpdateRequest.findOne({
                where: { alumni_user_id: alumniId, createdAt: { [db.Sequelize.Op.gte]: cooldownStart } },
                order: [["createdAt", "DESC"]], transaction, lock: transaction.LOCK.UPDATE
            });
            if (recentRequest) {
                const err = new Error("A profile update request was sent recently. Please wait seven days before sending another."); err.status = 429; throw err;
            }

            const request = await db.AlumniProfileUpdateRequest.create({
                alumni_user_id: alumniId,
                requested_by: req.user.id,
                status: "pending",
                request_message: requestMessage
            }, { transaction });
            const notification = await db.Notification.create({
                userId: alumniId,
                type: "profile_update_request",
                message: requestMessage,
                isRead: false
            }, { transaction });

            let emailQueueJob = null;
            if (alumni.email) {
                emailQueueJob = await db.EmailQueueJob.create({
                    to: alumni.email,
                    subject: "Please Update Your DJEMC Alumni Profile",
                    message: requestMessage,
                    dedupe_key: `alumni-profile-update:${request.id}`,
                    status: "pending",
                    attempts: 0,
                    scheduled_at: new Date()
                }, { transaction });
            }

            await request.update({
                notification_id: notification.id,
                email_queue_job_id: emailQueueJob?.id || null,
                status: "sent",
                sent_at: new Date()
            }, { transaction });
            await db.AuditLog.create({
                actor_id: req.user.id,
                actor_role: "admin",
                action: "alumni.profile_update.requested",
                target_type: "alumni",
                target_id: alumniId,
                metadata: { request_id: request.id },
                ip_address: req.ip || null
            }, { transaction });

            return { request, email_status: emailQueueJob ? "pending" : "unavailable" };
        });

        return res.status(201).json({
            msg: result.email_status === "pending"
                ? "Profile update request sent in-app; email is queued for delivery."
                : "Profile update request sent in-app. No email address is available for delivery.",
            request: result.request,
            email_status: result.email_status
        });
    } catch (err) {
        return res.status(err.status || 500).json({ msg: err.message || "Unable to send profile update request." });
    }
};

exports.updateAlumniUserStatus = async (req, res) => {
    try {
        const status = normalizeAccountStatus(req.body.status);
        if (!allowedAccountStatuses.includes(status)) {
            return res.status(400).json({ msg: "Invalid account status." });
        }

        const user = await db.User.findByPk(req.params.userId);
        if (!user || user.role !== "alumni") {
            return res.status(404).json({ msg: "Alumni user not found." });
        }

        const previousStatus = user.account_status;
        user.account_status = status;
        await user.save();
        await auditService.log({
            actorId: req.user.id,
            actorRole: "admin",
            action: "alumni.account_status.changed",
            targetType: "alumni",
            targetId: user.id,
            metadata: { from: previousStatus, to: status },
            ipAddress: req.ip
        });

        res.json({ msg: "Alumni account updated.", user });
    } catch (err) {
        res.status(500).json({ msg: err.message });
    }
};

exports.createAlumniAnnouncement = async (req, res) => {
    try {
        const { title, content, target_year, day, time, location } = req.body;
        if (!title || !content) {
            return res.status(400).json({ msg: "Title and content are required." });
        }

        const parsedTargetYear = parseTargetGraduationYear(target_year);
        if (!parsedTargetYear.valid) {
            return res.status(400).json({ msg: "Target graduation year must be a year such as 2023 or a range such as 2023-2026." });
        }

        const announcementTable = await db.sequelize.getQueryInterface().describeTable(
            db.Announcement.getTableName()
        );

        const announcementPayload = {
            title,
            content,
            admin_id: req.user.id
        };

        if (Object.prototype.hasOwnProperty.call(announcementTable, "day")) {
            announcementPayload.day = day || null;
        }

        if (Object.prototype.hasOwnProperty.call(announcementTable, "time")) {
            announcementPayload.time = time || null;
        }

        if (Object.prototype.hasOwnProperty.call(announcementTable, "location")) {
            announcementPayload.location = location || null;
        }

        const announcement = await db.Announcement.create(announcementPayload);

        const alumniWhere = { role: "alumni", account_status: "verified" };
        const alumniInclude = [];
        if (parsedTargetYear.range) {
            alumniInclude.push({
                model: db.AlumniProfile,
                where: { graduation_year: graduationYearWhere(parsedTargetYear.range, db.Sequelize) },
                attributes: []
            });
        }

        const alumniUsers = await db.User.findAll({
            where: alumniWhere,
            include: alumniInclude,
            attributes: ["id"]
        });
        const alumniIds = alumniUsers.map((u) => u.id);

        if (alumniIds.length) {
            await notificationController.createNotification({
                userIds: alumniIds,
                message: `New announcement: ${title}`,
                subject: "New Announcement from Alumni Admin"
            });
        }

        res.json(announcement);
    } catch (err) {
        res.status(500).json({ msg: err.message });
    }
};

exports.getAnnouncements = async (req, res) => {
    try {
        const announcements = await db.Announcement.findAll({
            order: [["createdAt", "DESC"]]
        });
        res.json(announcements);
    } catch (err) {
        res.status(500).json({ msg: err.message });
    }
};

exports.deleteAnnouncement = async (req, res) => {
    try {
        const announcement = await db.Announcement.findByPk(req.params.id);
        if (!announcement) return res.status(404).json({ msg: "Announcement not found." });

        await announcement.destroy();
        res.json({ msg: "Announcement deleted." });
    } catch (err) {
        res.status(500).json({ msg: err.message });
    }
};

// EMPLOYER ADMIN
exports.getEmployerUsers = async (req, res) => {
    try {
        const users = await db.User.findAll({
            where: { role: "employer" },
            attributes: ["id", "name", "email", "role", "account_status", "createdAt", "updatedAt"],
            include: [{ model: db.EmployerProfile, attributes: { include: ["business_permit_documents"] } }],
            order: [["createdAt", "DESC"]]
        });

        const decisions = await db.AuditLog.findAll({
            where: { target_type: "employer", target_id: users.map((user) => user.id), action: ["employer.verification.approved", "employer.verification.rejected"] },
            order: [["created_at", "DESC"]]
        });
        const latestDecision = new Map();
        decisions.forEach((decision) => { if (!latestDecision.has(Number(decision.target_id))) latestDecision.set(Number(decision.target_id), decision); });

        res.json(
            users.map((user) => {
                const plain = user.toJSON ? user.toJSON() : { ...user };
                const decision = latestDecision.get(Number(user.id));
                plain.verificationDecision = decision ? {
                    status: decision.action.endsWith("approved") ? "verified" : "rejected",
                    decided_at: decision.created_at,
                    reason: decision.metadata?.reason || null,
                    admin_id: decision.actor_id
                } : null;

                if (plain.EmployerProfile) {
                    const documents = require("../services/employerPermitDocuments").permitDocumentPayload(plain.EmployerProfile, user.id);
                    plain.EmployerProfile.business_permit_documents = documents;
                    // Keep the legacy response fields usable without encoding a
                    // private storage reference into a client-visible URL.
                    plain.EmployerProfile.business_permit_path = documents[0]?.url || null;
                    plain.EmployerProfile.business_permit_name = documents[0]?.name || null;
                }

                return plain;
            })
        );
    } catch (err) {
        res.status(500).json({ msg: err.message });
    }
};

exports.updateEmployerUserStatus = async (req, res) => {
    try {
        const status = normalizeAccountStatus(req.body.status);
        const isVerificationDecision = ["verified", "rejected"].includes(status);
        if (!["verified", "rejected", "suspended", "deactivated"].includes(status)) {
            return res.status(400).json({ msg: "Invalid employer account status." });
        }
        if (!allowedAccountStatuses.includes(status)) {
            return res.status(400).json({ msg: "Invalid account status." });
        }

        if (isVerificationDecision) {
            const rejectionReason = String(req.body.reason || "").trim();
            if (status === "rejected" && !rejectionReason) {
                return res.status(400).json({ msg: "A rejection reason is required." });
            }

            const result = await db.sequelize.transaction(async (transaction) => {
                const user = await db.User.findOne({
                    where: { id: req.params.userId, role: "employer", account_status: "pending" },
                    transaction,
                    lock: transaction.LOCK.UPDATE
                });
                if (!user) {
                    const existing = await db.User.findOne({ where: { id: req.params.userId, role: "employer" }, transaction });
                    const err = new Error(existing ? "This employer verification has already been decided. Refresh the list to see the latest status." : "Employer user not found.");
                    err.status = existing ? 409 : 404;
                    throw err;
                }

                const [profile] = await db.EmployerProfile.findOrCreate({
                    where: { user_id: user.id }, defaults: { user_id: user.id }, transaction
                });
                user.account_status = status;
                await user.save({ transaction });
                profile.verified = status === "verified";
                await profile.save({ transaction });

                const decisionDate = new Date();
                const decisionText = status === "verified"
                    ? `Dear ${profile.organization_name || user.name || "Employer"},\n\nWe are pleased to inform you that your employer account registration in the DJEMC Alumni Tracking and Job Portal has been approved.\n\nYour account has successfully completed the verification process.\n\nYou may now log in to the portal and access the employer features available to your account.\n\nThank you for joining the DJEMC Alumni Tracking and Job Portal.\n\nBest regards,\nDJEMC Alumni Portal Administration`
                    : `Dear ${profile.organization_name || user.name || "Employer"},\n\nWe regret to inform you that your employer account verification in the DJEMC Alumni Tracking and Job Portal was not approved.\n\nReason: ${rejectionReason}\n\nPlease contact the DJEMC Alumni Portal Administration for assistance regarding the required documents and possible resubmission.\n\nThank you for your understanding.\n\nBest regards,\nDJEMC Alumni Portal Administration`;
                const subject = status === "verified"
                    ? "DJEMC Alumni Portal — Employer Account Approved"
                    : "DJEMC Alumni Portal — Employer Verification Requires Additional Proof";
                const dedupeKey = `employer-verification:${user.id}:${status}`;
                let emailQueued = false;
                if (user.email) {
                    const existingJob = await db.EmailQueueJob.findOne({ where: { dedupe_key: dedupeKey }, transaction });
                    if (!existingJob) {
                        await enqueueEmails([{
                            to: user.email, subject, message: decisionText,
                            dedupe_key: dedupeKey, scheduled_at: decisionDate
                        }], { transaction });
                    }
                    emailQueued = true;
                }

                await db.AuditLog.create({
                    actor_id: req.user.id, actor_role: "admin",
                    action: status === "verified" ? "employer.verification.approved" : "employer.verification.rejected",
                    target_type: "employer", target_id: user.id,
                    metadata: { from: "pending", to: status, reason: status === "rejected" ? rejectionReason : null, decided_at: decisionDate.toISOString() },
                    ip_address: req.ip || null
                }, { transaction });

                return { user, profile, emailQueued, rejectionReason };
            });

            try {
                await db.Notification.create({
                    userId: result.user.id,
                    type: "verification",
                    message: status === "verified" ? "Your employer account has been verified by DJEMC Employer Admin" : `Your employer account was not approved. Reason: ${result.rejectionReason}`,
                    isRead: false
                });
            } catch (notificationError) {
                console.error("[employer verification] In-app notification failed:", notificationError.message);
            }
            return res.json({
                msg: result.emailQueued ? `Employer ${status === "verified" ? "approved" : "rejected"}; notification email is queued for delivery.` : `Employer ${status === "verified" ? "approved" : "rejected"}; no email address was available for delivery.`,
                user: result.user, profile: result.profile, email_status: result.emailQueued ? "pending" : "unavailable"
            });
        }

        const result = await db.sequelize.transaction(async (transaction) => {
            const allowedCurrentStatuses = status === "verified" ? ["deactivated", "suspended"] : ["verified", "pending"];
            const [updated] = await db.User.update(
                { account_status: status },
                { where: { id: req.params.userId, role: "employer", account_status: { [db.Sequelize.Op.in]: allowedCurrentStatuses } }, transaction }
            );
            if (!updated) {
                const user = await db.User.findOne({ where: { id: req.params.userId, role: "employer" }, transaction });
                const err = new Error(user ? "Employer status cannot be changed from its current state." : "Employer user not found.");
                err.status = user ? 409 : 404;
                throw err;
            }
            const user = await db.User.findByPk(req.params.userId, { transaction });
            const [profile] = await db.EmployerProfile.findOrCreate({ where: { user_id: user.id }, defaults: { user_id: user.id }, transaction });
            profile.verified = status === "verified";
            await profile.save({ transaction });
            return { user, profile };
        });
        return res.json({ msg: "Employer account updated.", ...result });
    } catch (err) {
        res.status(err.status || 500).json({ msg: err.message || "Unable to update employer account." });
    }
};

const createWarningNotification = async (req, res, role) => {
    try {
        const { userId, message } = req.body;
        if (!userId || !message) {
            return res.status(400).json({ msg: "userId and message are required." });
        }

        const user = await db.User.findByPk(userId);
        if (!user || user.role !== role) {
            return res.status(404).json({ msg: `${role} user not found.` });
        }

        await notificationController.createNotification({
            userIds: [user.id],
            message,
            subject: "Admin Warning",
            type: "warning"
        });

        return res.json({ msg: "Warning sent." });
    } catch (err) {
        return res.status(500).json({ msg: err.message });
    }
};

exports.createAlumniWarning = async (req, res) => createWarningNotification(req, res, "alumni");
exports.createEmployerWarning = async (req, res) => createWarningNotification(req, res, "employer");

exports.updateJobApprovalStatus = async (req, res) => {
    try {
        const approvalStatus = normalizeJobStatus(req.body.approval_status);
        if (!allowedJobStatuses.includes(approvalStatus)) {
            return res.status(400).json({ msg: "Invalid job approval status." });
        }

        const job = await db.Job.findByPk(req.params.jobId, {
            include: [{ model: db.User, attributes: ["id", "name", "email"] }]
        });
        if (!job) return res.status(404).json({ msg: "Job not found." });

        job.approval_status = approvalStatus;
        job.reviewed_by_admin_id = req.user.id;
        await job.save();

        // Notify employer about status update (approval status changed, not about new job)
        await notificationController.createNotification({
            userIds: [job.employer_id],
            message:
                approvalStatus === "approved"
                    ? `Your job "${job.title}" has been approved and is now visible to alumni.`
                    : `Your job "${job.title}" was marked as ${approvalStatus}.`,
            subject: "Job Post Review Update"
        });

        res.json({ msg: "Job approval status updated.", job });
    } catch (err) {
        res.status(500).json({ msg: err.message });
    }
};

exports.deleteEmployerJob = async (req, res) => {
    try {
        const job = await db.Job.findByPk(req.params.jobId);
        if (!job) return res.status(404).json({ msg: "Job not found." });
        if (job.reviewed_by_admin_id !== req.user.id) {
            return res.status(403).json({ msg: "You can only remove jobs reviewed by your admin account." });
        }

        job.approval_status = "rejected";
        await job.save();

        res.json({ msg: "Job removed from listings without deleting application data.", job });
    } catch (err) {
        res.status(500).json({ msg: err.message });
    }
};



