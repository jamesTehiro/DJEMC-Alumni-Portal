const fs = require("fs");
const path = require("path");
const db = require("../models");
const { uploadDataUrl, isObjectStorageEnabled } = require("../services/objectStorage");
const { validateAlumniProfile, saveAlumniProfile } = require("../services/alumniProfileSave");
const sanitizeValue = require("../middleware/sanitizeMiddleware").sanitizeValue;

const uploadsDir = path.join(__dirname, "..", "uploads");
const imageUploadsDir = path.join(uploadsDir, "images");
const maxBase64UploadBytes = Number(process.env.MAX_PROFILE_UPLOAD_MB || 5) * 1024 * 1024;
const allowedImageMimes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const profileImagePathPattern = /^\/uploads(?:\/images)?\/([^/?#]+)$/i;

const buildCanonicalImagePath = (fileName) => {
    const safeFileName = path.basename(String(fileName || ""));
    return safeFileName ? `/uploads/images/${safeFileName}` : null;
};

const normalizeStoredImagePath = (value) => {
    if (!value || typeof value !== "string") return null;
    if (/^(?:data:|blob:|file:)/i.test(value) || /^[a-z]:[\\/]/i.test(value)) {
        const err = new Error("Upload a profile image instead of saving a temporary or local file path.");
        err.status = 400;
        throw err;
    }
    if (/^https?:\/\//i.test(value)) return value;

    const match = value.match(profileImagePathPattern);
    if (!match) return value;
    return buildCanonicalImagePath(match[1]);
};

const parseProfilePayload = (body) => {
    if (typeof body?.payload !== "string") return body || {};
    let payload;
    try { payload = JSON.parse(body.payload); }
    catch { throw Object.assign(new Error("Invalid profile upload data."), { status: 400 }); }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw Object.assign(new Error("Invalid profile upload data."), { status: 400 });
    }
    return sanitizeValue(payload);
};

const saveBase64Image = async (dataUrl, prefix = "file") => {
    if (!dataUrl || typeof dataUrl !== "string") return null;
    const matches = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!matches) return null;
    if (!allowedImageMimes.has(matches[1])) {
        const err = new Error("Unsupported image type.");
        err.status = 400;
        throw err;
    }

    const buffer = Buffer.from(matches[2], "base64");
    if (buffer.byteLength > maxBase64UploadBytes) {
        const err = new Error("Image exceeds allowed size.");
        err.status = 400;
        throw err;
    }

    if (process.env.NODE_ENV === "production" && !isObjectStorageEnabled()) {
        const err = new Error("Profile photo storage is not configured. Please try again later.");
        err.status = 503;
        err.publicMessage = err.message;
        throw err;
    }

    if (isObjectStorageEnabled()) {
        let uploadedUrl;
        try {
            uploadedUrl = await uploadDataUrl({ dataUrl, folder: "uploads/images", prefix });
        } catch {
            const err = new Error("Profile photo storage is unavailable. Please try again later.");
            err.status = 502;
            err.publicMessage = err.message;
            throw err;
        }
        if (!uploadedUrl) {
            const err = new Error("The profile photo could not be stored. Please try again.");
            err.status = 502;
            throw err;
        }
        return uploadedUrl;
    }

    if (!fs.existsSync(imageUploadsDir)) {
        fs.mkdirSync(imageUploadsDir, { recursive: true });
    }

    const extension = matches[1].split("/")[1] || "png";
    const fileName = `${prefix}-${Date.now()}-${Math.round(Math.random() * 1e6)}.${extension}`;
    const filePath = path.join(imageUploadsDir, fileName);
    await fs.promises.writeFile(filePath, buffer);
    return buildCanonicalImagePath(fileName);
};

const baseProfileInclude = [
    {
        model: db.AlumniProfile,
        include: [{ model: db.EmploymentHistory }]
    },
    { model: db.EmployerProfile }
];

const toLimitedProfile = (target) => ({
    id: target.id,
    name: target.name,
    role: target.role,
    AlumniProfile: target.AlumniProfile
        ? {
            course: target.AlumniProfile.course,
            major: target.AlumniProfile.major,
            graduation_year: target.AlumniProfile.graduation_year,
            avatar_url: target.AlumniProfile.avatar_url,
            profile_visibility: target.AlumniProfile.profile_visibility || "private",
            employment_status: target.AlumniProfile.employment_status ?? null,
            current_company: target.AlumniProfile.current_company ?? null,
            job_title: target.AlumniProfile.job_title ?? null,
            address: target.AlumniProfile.address ?? null
        }
        : null,
    EmployerProfile: target.EmployerProfile

        ? {
            organization_name: target.EmployerProfile.organization_name,
            logo_url: target.EmployerProfile.logo_url
        }
        : null,
    admin_department: target.admin_department || null,
    admin_avatar_url: target.admin_avatar_url || null
});

const canEmployerViewAlumniResume = async (employerId, alumniId) => {
    const application = await db.Application.findOne({
        where: { alumni_id: alumniId },
        include: [
            {
                model: db.Job,
                where: { employer_id: employerId }
            }
        ]
    });

    return !!application;
};

// GET current user's profile
exports.getProfile = async (req, res) => {
    try {
        const user = await db.User.findByPk(req.user.id, {
            include: baseProfileInclude,
            attributes: { exclude: ["password"] }
        });
        res.json(user);
    } catch (err) {
        res.status(500).json({ msg: err.message });
    }
};

exports.normalizeStoredImagePath = normalizeStoredImagePath;
exports.buildCanonicalImagePath = buildCanonicalImagePath;
exports.parseProfilePayload = parseProfilePayload;

// GET a user's profile with access rules
exports.getUserProfileById = async (req, res) => {
    try {
        const targetUserId = Number(req.params.userId);
        if (!targetUserId) {
            return res.status(400).json({ msg: "Invalid user id." });
        }

        const viewer = await db.User.findByPk(req.user.id);
        if (!viewer) {
            return res.status(401).json({ msg: "Unauthorized" });
        }

        const target = await db.User.findByPk(targetUserId, {
            include: baseProfileInclude,
            attributes: { exclude: ["password"] }
        });
        if (!target) {
            return res.status(404).json({ msg: "User not found" });
        }

        const isSelf = viewer.id === target.id;
        const isAdmin = viewer.role === "admin";

        if (!isSelf && !isAdmin && viewer.role === "employer" && target.role === "alumni") {
            const allowed = await canEmployerViewAlumniResume(viewer.id, target.id);
            if (!allowed) {
                return res.status(403).json({
                    msg: "You can view this alumni profile only after they apply to one of your jobs."
                });
            }
        }

        const targetVisibility = target.AlumniProfile?.profile_visibility || "public";
        if (!isSelf && !isAdmin && target.role === "alumni" && targetVisibility !== "public") {
            return res.json(toLimitedProfile(target));
        }

        res.json(target);
    } catch (err) {
        res.status(500).json({ msg: err.message });
    }
};

// UPDATE profile
exports.updateProfile = async (req, res, next) => {
    try {
        req.body = parseProfilePayload(req.body);
        const {
            name,
            email,
            course,
            graduation_year,
            phone,
            address,
            profile_visibility,
            avatar_url,
            employment_status,
            current_company,
            job_title,
            employment_history,
            organization_name,
            industry,
            contact_email,
            logo_url,
            admin_department,
            admin_avatar_url
        } = req.body;

        const user = await db.User.findByPk(req.user.id);
        if (!user) return res.status(404).json({ msg: "User not found" });

        if (user.role === "alumni") {
            validateAlumniProfile(req.body, user);
            const avatarUpload = req.files?.avatar_image?.[0];
            const avatarPath = avatarUpload
                ? avatarUpload.publicUrl || buildCanonicalImagePath(avatarUpload.filename)
                : await saveBase64Image(avatar_url, "avatar");
            if (avatarUpload && process.env.NODE_ENV === "production" && !avatarUpload.publicUrl) {
                const err = new Error("Profile photo storage is unavailable. Please try again later.");
                err.status = 503;
                err.publicMessage = err.message;
                throw err;
            }
            const saved = await saveAlumniProfile({ user, body: req.body, avatarPath, normalizeImagePath: normalizeStoredImagePath });

            const careerFields = ["employment_status", "current_company", "job_title", "employment_history"];
            const updatedCareerFields = careerFields.filter((field) => Object.prototype.hasOwnProperty.call(req.body, field));
            if (updatedCareerFields.length) {
                const completedAt = new Date();
                try {
                    await db.sequelize.transaction(async (transaction) => {
                        const openRequests = await db.AlumniProfileUpdateRequest.findAll({
                            where: {
                                alumni_user_id: req.user.id,
                                status: { [db.Sequelize.Op.in]: ["pending", "sent", "responded"] }
                            },
                            attributes: ["id"],
                            transaction,
                            lock: transaction.LOCK.UPDATE
                        });
                        if (openRequests.length) {
                            await db.AlumniProfileUpdateRequest.update({
                                status: "completed",
                                responded_at: completedAt,
                                completed_at: completedAt
                            }, {
                                where: { id: openRequests.map((request) => request.id) },
                                transaction
                            });
                        }
                        await db.AuditLog.create({
                            actor_id: req.user.id,
                            actor_role: "alumni",
                            action: "alumni.profile.updated",
                            target_type: "alumni",
                            target_id: req.user.id,
                            metadata: {
                                fields: updatedCareerFields,
                                completed_request_ids: openRequests.map((request) => request.id)
                            },
                            ip_address: req.ip || null
                        }, { transaction });
                    });
                } catch (trackingError) {
                    console.error("[profile-tracking] Unable to record alumni profile update:", trackingError.message);
                }
            }
            return res.json({ msg: "Profile updated", ...saved });
        }

        await user.update({ name: name ?? user.name, email: email ?? user.email });

        if (user.role === "employer") {
            const logoUpload = req.files?.logo_image?.[0];
            const logoPath = logoUpload
                ? logoUpload.publicUrl || buildCanonicalImagePath(logoUpload.filename)
                : await saveBase64Image(logo_url, "logo");
            const [employerProfile] = await db.EmployerProfile.findOrCreate({
                where: { user_id: req.user.id },
                defaults: { user_id: req.user.id }
            });

            await employerProfile.update({
                organization_name: organization_name ?? employerProfile.organization_name,
                industry: industry ?? employerProfile.industry,
                address: address ?? employerProfile.address,
                contact_email: contact_email ?? employerProfile.contact_email,
                logo_url:
                    logoPath ||
                    normalizeStoredImagePath(logo_url) ||
                    normalizeStoredImagePath(employerProfile.logo_url)
            });
        }

        if (user.role === "admin") {
            const adminAvatarPath = await saveBase64Image(admin_avatar_url, "admin-avatar");
            await user.update({
                name: name ?? user.name,
                email: email ?? user.email,
                admin_department: admin_department ?? user.admin_department,
                admin_avatar_url:
                    adminAvatarPath ||
                    normalizeStoredImagePath(admin_avatar_url) ||
                    normalizeStoredImagePath(user.admin_avatar_url)
            });
        }

        const updatedUser = await db.User.findByPk(req.user.id, {
            include: baseProfileInclude,
            attributes: { exclude: ["password"] }
        });

        res.json({ msg: "Profile updated", user: updatedUser });
    } catch (err) {
        next(err);
    }
};
