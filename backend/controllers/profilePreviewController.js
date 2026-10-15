const db = require("../models");

// GET /api/profile/:userId/preview
// The feed preview exposes only identity, a photo, and public employment history.
// Full profile details remain available through the separate profile endpoints.
exports.getProfilePreview = async (req, res) => {
    try {
        const targetUserId = Number(req.params.userId);
        if (!Number.isSafeInteger(targetUserId) || targetUserId <= 0) {
            return res.status(400).json({ msg: "Invalid user id." });
        }

        if (!req.user?.id) {
            return res.status(401).json({ msg: "Unauthorized" });
        }

        const viewer = await db.User.findByPk(req.user.id, {
            attributes: ["id", "role"]
        });
        if (!viewer) {
            return res.status(401).json({ msg: "Unauthorized" });
        }

        const target = await db.User.findByPk(targetUserId, {
            include: [
                {
                    model: db.AlumniProfile,
                    attributes: ["avatar_url", "profile_visibility"],
                    include: [{
                        model: db.EmploymentHistory,
                        attributes: ["id", "company_name", "position", "start_year", "end_year", "employment_type"]
                    }]
                },
                { model: db.EmployerProfile, attributes: ["logo_url"] }
            ],
            attributes: ["id", "name", "role", "admin_avatar_url"]
        });

        if (!target) {
            return res.status(404).json({ msg: "User not found" });
        }

        const isSelf = viewer.id === target.id;
        const isAdmin = viewer.role === "admin";

        // Employer access check
        if (!isSelf && !isAdmin && viewer.role === "employer" && target.role === "alumni") {
            const application = await db.Application.findOne({
                where: { alumni_id: target.id },
                include: [
                    {
                        model: db.Job,
                        where: { employer_id: viewer.id }
                    }
                ]
            });
            if (!application) {
                return res.status(403).json({
                    msg: "You can view this alumni profile only after they apply to one of your jobs."
                });
            }
        }

        // Only explicit public visibility permits history in a feed preview,
        // including when the viewer owns the profile or is an administrator.
        const isAlumni = target.role === "alumni";
        const isPrivate = isAlumni && String(target.AlumniProfile?.profile_visibility || "").trim().toLowerCase() !== "public";
        const profileData = {
            id: target.id,
            name: target.name,
            role: target.role,
            isPrivate,
            AlumniProfile: isAlumni && target.AlumniProfile
                ? {
                    avatar_url: target.AlumniProfile.avatar_url,
                    EmploymentHistories: !isPrivate && target.AlumniProfile.EmploymentHistories
                        ? target.AlumniProfile.EmploymentHistories.map((eh) => ({
                            id: eh.id,
                            company_name: eh.company_name,
                            position: eh.position,
                            start_year: eh.start_year,
                            end_year: eh.end_year,
                            employment_type: eh.employment_type
                        }))
                        : []
                }
                : null,
            EmployerProfile: target.role === "employer" && target.EmployerProfile
                ? {
                    logo_url: target.EmployerProfile.logo_url
                }
                : null
        };

        if (target.role === "admin") {
            profileData.admin_avatar_url = target.admin_avatar_url;
        }

        return res.json(profileData);
    } catch (err) {
        return res.status(500).json({ msg: "Unable to load profile preview." });
    }
};
