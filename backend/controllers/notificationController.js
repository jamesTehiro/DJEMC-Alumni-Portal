// controllers/notificationController.js
const db = require("../models");
const { enqueueEmails } = require("../utils/emailQueue");

// Create notifications & send emails
exports.createNotification = async ({ userIds, message, subject, type, interview_id }) => {
    try {
        const normalizedIds = Array.from(new Set((userIds || []).filter(Boolean)));
        if (!normalizedIds.length) return [];

        const notifications = await db.Notification.bulkCreate(
            normalizedIds.map((userId) => ({ userId, type, message, interview_id })),
            { returning: true }
        );

        const users = await db.User.findAll({ where: { id: normalizedIds } });
        await enqueueEmails(users.map((user) => ({ to: user.email, subject, message })));

        return notifications;
    } catch (err) {
        console.error("Notification error:", err.message);
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
        res.status(500).json({ msg: err.message });
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
        res.status(500).json({ msg: err.message });
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
                    console.error("[profile-tracking] Unable to log update request response:", auditError.message);
                }
            }
        }
        res.json({ msg: "Notification marked as read" });
    } catch (err) {
        res.status(500).json({ msg: err.message });
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
        res.status(500).json({ msg: err.message });
    }
};
