const db = require("../models");
const notificationController = require("./notificationController");
const { parseTargetGraduationYear, graduationYearWhere } = require("../utils/targetGraduationYear");

// CREATE ANNOUNCEMENT (admin only)
exports.createAnnouncement = async (req, res) => {
    try {
        const { title, content, target_year } = req.body;
        if (!title || !content) {
            return res.status(400).json({ msg: "Title and content are required." });
        }

        const parsedTargetYear = parseTargetGraduationYear(target_year);
        if (!parsedTargetYear.valid) {
            return res.status(400).json({ msg: "Target graduation year must be a year such as 2023 or a range such as 2023-2026." });
        }

        const announcement = await db.Announcement.create({
            title,
            content,
            admin_id: req.user.id
        });

        const alumniWhere = { role: "alumni" };
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
                subject: "New Announcement from DJEMC Admin"
            });
        }

        res.json(announcement);
    } catch (err) {
        res.status(500).json({ msg: err.message });
    }
};

// GET ALL ANNOUNCEMENTS
exports.getAnnouncements = async (req, res) => {
    try {
        const announcements = await db.Announcement.findAll({
            include: [
                {
                    model: db.User,
                    as: "admin",
                    attributes: ["id", "name", "role", "admin_scope", "admin_avatar_url"]
                },
                { model: db.Comment }
            ]
        });
        res.json(announcements);
    } catch (err) {
        res.status(500).json({ msg: err.message });
    }
};
