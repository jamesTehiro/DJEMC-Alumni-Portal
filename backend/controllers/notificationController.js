// controllers/notificationController.js
const db = require("../models");
const { enqueueEmails } = require("../utils/emailQueue");
const { safeEmailError } = require("../utils/emailDiagnostics");
const reportFailure = (operation, error, res) => {
    console.error("[notification] operation failed", { operation, ...safeEmailError(error) });
    if (res) return res.status(500).json({ msg: "Notifications are temporarily unavailable. Please try again later." });
};

// Create notifications & send emails
exports.createNotification = async ({ userIds, message, subject, type, interview_id }) => {
    try {
        const normalizedIds = Array.from(new Set((userIds || []).filter(Boolean)));
        if (!normalizedIds.length) return [];

        return await db.sequelize.transaction(async transaction => {
            const notifications = await db.Notification.bulkCreate(
                normalizedIds.map((userId) => ({ userId, type, message, interview_id })),
                { returning: true, transaction }
            );
            const users = await db.User.findAll({ where: { id: normalizedIds }, transaction });
            await enqueueEmails(users.map((user) => ({ to: user.email, subject, message })), { transaction });
            return notifications;
        });
    } catch (err) {
        reportFailure("create", err);
        return [];
    }
};

// Get all notifications for logged-in user
exports.getUserNotifications = async (req, res) => {
    try {
        const notifications = await db.Notification.findAll({
            where: { userId: req.user.id },
            include: [
                {
                    model: db.Interview,
                    attributes: ["id", "application_id", "venue", "place", "date", "time", "contact_info", "what_to_bring"]
                }
            ],
            order: [["createdAt", "DESC"]]
        });
        res.json(notifications);
    } catch (err) {
        reportFailure("list", err, res);
    }
};

// Get interview details for a specific notification
exports.getNotificationInterview = async (req, res) => {
    try {
        const notification = await db.Notification.findByPk(req.params.id, {
            include: [
                {
                    model: db.Interview,
                    attributes: ["id", "application_id", "venue", "place", "date", "time", "contact_info", "what_to_bring"]
                }
            ]
        });

        if (!notification) return res.status(404).json({ msg: "Not found" });
        if (notification.userId !== req.user.id) {
            return res.status(403).json({ msg: "Forbidden" });
        }
        if (!notification.Interview) {
            return res.status(404).json({ msg: "Interview details not found." });
        }

        res.json(notification);
    } catch (err) {
        reportFailure("interview", err, res);
    }
};

// Mark notification as read
exports.markAsRead = async (req, res) => {
    try {
        const notification = await db.Notification.findByPk(req.params.id);
        if (!notification) return res.status(404).json({ msg: "Not found" });
        if (notification.userId !== req.user.id) {
            return res.status(403).json({ msg: "Forbidden" });
        }

        notification.isRead = true;
        await notification.save();
        if (notification.type === "profile_update_request") {
            const profileRequest = await db.AlumniProfileUpdateRequest.findOne({
                where: { notification_id: notification.id, alumni_user_id: req.user.id, status: "sent" }
            });
            if (profileRequest) {
                const respondedAt = new Date();
                await profileRequest.update({ status: "responded", responded_at: respondedAt });
                try {
                    await db.AuditLog.create({
                        actor_id: req.user.id,
                        actor_role: "alumni",
                        action: "alumni.profile_update.responded",
                        target_type: "alumni",
                        target_id: req.user.id,
                        metadata: { request_id: profileRequest.id },
                        ip_address: req.ip || null
                    });
                } catch (auditError) {
                    reportFailure("profile_update_audit", auditError);
                }
            }
        }
        res.json({ msg: "Notification marked as read" });
    } catch (err) {
        reportFailure("read", err, res);
    }
};

// Delete notification
exports.deleteNotification = async (req, res) => {
    try {
        const notification = await db.Notification.findByPk(req.params.id);
        if (!notification) return res.status(404).json({ msg: "Not found" });
        if (notification.userId !== req.user.id) {
            return res.status(403).json({ msg: "Forbidden" });
        }

        await notification.destroy();
        res.json({ msg: "Notification deleted" });
    } catch (err) {
        reportFailure("delete", err, res);
    }
};
