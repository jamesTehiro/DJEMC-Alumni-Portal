const db = require("../models");
const { toSecureFileUrl } = require("./fileController");
const { getStoredFileOriginalName } = require("../services/objectStorage");
exports.replacePermit = async (req, res, next) => {
    try {
        if (req.user?.role !== "admin" || req.user.admin_scope !== "employer") return res.status(403).json({ msg: "Employer admin access required." });
        const file = req.files?.business_permit?.[0];
        const reference = file?.storageRef || (file?.filename ? `/uploads/documents/${file.filename}` : null);
        if (!reference) return res.status(400).json({ msg: "Select a valid business permit file." });
        const profile = await db.sequelize.transaction(async transaction => {
            const user = await db.User.findByPk(req.params.userId, { transaction });
            if (!user || user.role !== "employer") { const error = new Error("Employer not found."); error.status = 404; throw error; }
            const profile = await db.EmployerProfile.findOne({ where: { user_id: user.id }, transaction, lock: transaction.LOCK?.UPDATE });
            if (!profile) { const error = new Error("Employer profile not found."); error.status = 404; throw error; }
            await profile.update({ business_permit_path: reference }, { transaction });
            await profile.reload({ transaction });
            if (profile.business_permit_path !== reference) throw new Error("Business permit could not be saved.");
            return profile;
        });
        res.json({ msg: "Business permit saved. Verification status is unchanged.", business_permit_path: toSecureFileUrl(profile.business_permit_path), business_permit_name: getStoredFileOriginalName(reference) || file.originalname || file.filename });
    } catch (error) { next(error); }
};
