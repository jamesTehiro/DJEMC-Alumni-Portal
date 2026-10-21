const db = require("../models");
const { validateAcademicProgram } = require("../utils/academicPrograms");

const invalid = (message) => { throw Object.assign(new Error(message), { status: 400 }); };
const has = (body, field) => Object.prototype.hasOwnProperty.call(body, field);

function validateAlumniProfile(body, user) {
    const name = String(body.name ?? user.name ?? "").trim();
    const email = String(body.email ?? user.email ?? "").trim();
    if (!name || name.length > 255) invalid("Enter a name of up to 255 characters.");
    if (email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) invalid("Enter a valid email address.");
    for (const field of ["phone", "address", "course", "major", "current_company", "job_title"]) {
        if (has(body, field) && body[field] !== null && (typeof body[field] !== "string" || body[field].length > 255)) invalid(`${field} must be text of up to 255 characters.`);
    }
    if (has(body, "profile_visibility") && !["public", "private"].includes(body.profile_visibility)) invalid("Invalid profile visibility.");
    if (has(body, "employment_status") && body.employment_status && !["employed", "unemployed", "self-employed"].includes(String(body.employment_status).trim().toLowerCase())) invalid("Invalid employment_status.");
    const year = (value, field) => {
        if (value === "" || value === null || value === undefined) return null;
        const result = Number(value);
        if (!Number.isInteger(result) || result < 1900 || result > new Date().getFullYear() + 10) invalid(`Invalid ${field}.`);
        return result;
    };
    if (has(body, "graduation_year")) year(body.graduation_year, "graduation_year");
    let history;
    if (has(body, "employment_history")) {
        if (!Array.isArray(body.employment_history) || body.employment_history.length > 100) invalid("Employment history must contain up to 100 entries.");
        history = body.employment_history.map((entry) => {
            if (!entry || typeof entry !== "object" || Array.isArray(entry)) invalid("Invalid employment history entry.");
            for (const field of ["company_name", "position", "employment_type"]) {
                if (entry[field] !== undefined && entry[field] !== null && typeof entry[field] !== "string") invalid("Employment history names and positions must be text.");
            }
            const company = String(entry.company_name || "").trim();
            const position = String(entry.position || "").trim();
            const type = String(entry.employment_type || "Full-time").trim();
            if (!company && !position && !entry.start_year && !entry.end_year) return null;
            const start = year(entry.start_year, "employment start year");
            const end = entry.end_year === "Present" ? null : year(entry.end_year, "employment end year");
            if (!company || !position || !start) invalid("Each employment entry needs a company, position, and start year.");
            if ([company, position, type].some(value => value.length > 255)) invalid("Employment history values must be up to 255 characters.");
            if (end && end < start) invalid("Employment end year cannot be before the start year.");
            return { company_name: company, position, start_year: start, end_year: end, employment_type: type };
        }).filter(Boolean);
    }
    if (has(body, "membership_profile_completion") && typeof body.membership_profile_completion !== "boolean") invalid("Invalid membership profile completion request.");
    return { name, email, history };
}

async function saveAlumniProfile({ user, body, avatarPath, normalizeImagePath }) {
    const clean = validateAlumniProfile(body, user);
    return db.sequelize.transaction(async transaction => {
        const owner = await db.User.findByPk(user.id, { transaction, lock: transaction.LOCK.UPDATE });
        if (!owner || owner.role !== "alumni") throw Object.assign(new Error("Alumni account not found."), { status: 403 });
        let membership;
        if (body.membership_profile_completion === true) {
            if (owner.account_status !== "verified") throw Object.assign(new Error("A verified alumni account is required."), { status: 403 });
            membership = await db.MembershipApplication.findOne({ where: { alumni_user_id: owner.id, application_status: "submitted" }, transaction, lock: transaction.LOCK.UPDATE });
            if (!membership) invalid("Submit your membership application before completing this step.");
        }
        await owner.update({ name: clean.name, email: clean.email }, { transaction });
        const [profile] = await db.AlumniProfile.findOrCreate({ where: { user_id: owner.id }, defaults: { user_id: owner.id }, transaction });
        const values = {};
        if (has(body, "course") || has(body, "major")) {
            const changedProgram = has(body, "course") && String(body.course || "").trim() !== String(profile.course || "").trim();
            Object.assign(values, validateAcademicProgram(has(body, "course") ? body.course : profile.course, has(body, "major") ? body.major : changedProgram ? null : profile.major, { previous: profile, required: false }));
        }
        for (const field of ["graduation_year", "phone", "address", "profile_visibility", "current_company", "job_title"]) {
            if (has(body, field)) values[field] = field === "graduation_year" ? (body[field] ? Number(body[field]) : null) : body[field];
        }
        if (has(body, "employment_status")) values.employment_status = body.employment_status ? String(body.employment_status).trim().toLowerCase() : null;
        if (avatarPath || has(body, "avatar_url")) values.avatar_url = avatarPath || normalizeImagePath(body.avatar_url) || normalizeImagePath(profile.avatar_url);
        await profile.update(values, { transaction });
        if (clean.history !== undefined) {
            await db.EmploymentHistory.destroy({ where: { alumni_id: profile.id }, transaction });
            if (clean.history.length) await db.EmploymentHistory.bulkCreate(clean.history.map(item => ({ ...item, alumni_id: profile.id })), { transaction });
        }
        if (membership && !membership.profile_completed_at) {
            await membership.update({ profile_completed_at: new Date() }, { transaction });
            await db.AuditLog.create({ actor_id: owner.id, actor_role: "alumni", action: "membership.profile.completed", target_type: "membership_application", target_id: membership.id, metadata: { fields: ["profile_completed_at"] } }, { transaction });
        }
        const updated = await db.User.findByPk(owner.id, {
            attributes: { exclude: ["password"] },
            include: [{ model: db.AlumniProfile, include: [{ model: db.EmploymentHistory }] }, { model: db.EmployerProfile }],
            transaction
        });
        return { user: updated, membership_profile_completed: !!membership?.profile_completed_at };
    });
}

module.exports = { validateAlumniProfile, saveAlumniProfile };
