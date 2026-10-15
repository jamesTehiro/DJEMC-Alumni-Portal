const { Resume, ResumePersonalInfo, ResumeSummary, ResumeEducation, ResumeWorkExperience,
    ResumeSkill, ResumeProject, ResumeCertification, ResumeTraining, ResumeSeminar,
    ResumeAward, ResumeOrganization, ResumeVolunteerWork, ResumeLanguage, ResumeReference, ResumeVersion } = require("../models");

// Helper to sanitize user input
const sanitize = (str) => {
    if (typeof str !== 'string') return str;
    return str.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<[^>]*>/g, '')
        .trim();
};

exports.getResumes = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) return res.status(401).json({ message: "Unauthorized" });

        const resumes = await Resume.findAll({
            where: { user_id: userId, is_archived: false },
            order: [["createdAt", "DESC"]]
        });

        const populated = await Promise.all(resumes.map(async (r) => {
            const personalInfo = await ResumePersonalInfo.findOne({ where: { resume_id: r.id } });
            return {
                ...r.toJSON(),
                personalInfo: personalInfo ? { full_name: personalInfo.full_name } : null
            };
        }));

        res.json({ data: populated });
    } catch (err) {
        console.error("getResumes error:", err);
        res.status(500).json({ message: "Failed to fetch resumes" });
    }
};

exports.getResume = async (req, res) => {
    try {
        const userId = req.user?.id;
        const resumeId = req.params.id;

        const resume = await Resume.findOne({ where: { id: resumeId, user_id: userId } });
        if (!resume) return res.status(404).json({ message: "Resume not found" });

        const [personalInfo, summary, education, workExperience, skills, projects, certifications,
            trainings, seminars, awards, organizations, volunteerWork, languages, references] = await Promise.all([
                ResumePersonalInfo.findOne({ where: { resume_id: resumeId } }),
                ResumeSummary.findOne({ where: { resume_id: resumeId } }),
                ResumeEducation.findAll({ where: { resume_id: resumeId }, order: [['sort_order', 'ASC'], ['id', 'ASC']] }),
                ResumeWorkExperience.findAll({ where: { resume_id: resumeId }, order: [['sort_order', 'ASC'], ['id', 'ASC']] }),
                ResumeSkill.findAll({ where: { resume_id: resumeId }, order: [['sort_order', 'ASC'], ['id', 'ASC']] }),
                ResumeProject.findAll({ where: { resume_id: resumeId }, order: [['sort_order', 'ASC'], ['id', 'ASC']] }),
                ResumeCertification.findAll({ where: { resume_id: resumeId }, order: [['sort_order', 'ASC'], ['id', 'ASC']] }),
                ResumeTraining.findAll({ where: { resume_id: resumeId }, order: [['sort_order', 'ASC'], ['id', 'ASC']] }),
                ResumeSeminar.findAll({ where: { resume_id: resumeId }, order: [['sort_order', 'ASC'], ['id', 'ASC']] }),
                ResumeAward.findAll({ where: { resume_id: resumeId }, order: [['sort_order', 'ASC'], ['id', 'ASC']] }),
                ResumeOrganization.findAll({ where: { resume_id: resumeId }, order: [['sort_order', 'ASC'], ['id', 'ASC']] }),
                ResumeVolunteerWork.findAll({ where: { resume_id: resumeId }, order: [['sort_order', 'ASC'], ['id', 'ASC']] }),
                ResumeLanguage.findAll({ where: { resume_id: resumeId }, order: [['sort_order', 'ASC'], ['id', 'ASC']] }),
                ResumeReference.findAll({ where: { resume_id: resumeId }, order: [['sort_order', 'ASC'], ['id', 'ASC']] })
            ]);

        res.json({
            ...resume.toJSON(),
            personalInfo: personalInfo || {},
            summary: summary || {},
            education: education || [],
            workExperience: workExperience || [],
            skills: skills || [],
            projects: projects || [],
            certifications: certifications || [],
            trainings: trainings || [],
            seminars: seminars || [],
            awards: awards || [],
            organizations: organizations || [],
            volunteerWork: volunteerWork || [],
            languages: languages || [],
            references: references || []
        });
    } catch (err) {
        console.error("getResume error:", err);
        res.status(500).json({ message: "Failed to fetch resume" });
    }
};

const db = require('../models');
const { Op } = require('sequelize');
const { normalizeSections, saveSections, readSections, badRequest, normalizeTemplateId } = require('../services/resumePersistence');

function mainResumeFields(body) {
    const result = {};
    for (const key of ['title', 'template_id', 'font_family', 'font_size', 'line_spacing', 'color_theme', 'settings', 'is_default', 'is_archived']) {
        if (body[key] !== undefined) result[key] = body[key];
    }
    if (result.title !== undefined) result.title = sanitize(result.title) || 'My Resume';
    if (result.template_id !== undefined) result.template_id = normalizeTemplateId(result.template_id);
    if (result.font_size !== undefined && (!Number.isInteger(Number(result.font_size)) || result.font_size < 8 || result.font_size > 14)) throw badRequest('Font size must be between 8 and 14 pt.');
    if (result.line_spacing !== undefined && (!Number.isFinite(Number(result.line_spacing)) || result.line_spacing < 1.15 || result.line_spacing > 2)) throw badRequest('Line spacing must be between 1.15 and 2.');
    if (result.settings !== undefined && (!result.settings || typeof result.settings !== 'object' || Array.isArray(result.settings))) throw badRequest('Invalid resume settings.');
    const key = result.settings?.client_draft_id;
    if (key !== undefined && (typeof key !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(key))) throw badRequest('Invalid resume draft identifier.');
    return result;
}

const lockResumeOwner = async (userId, transaction) => {
    const owner = await db.User.findByPk(userId, { attributes: ['id'], transaction, lock: transaction.LOCK.UPDATE });
    if (!owner) throw Object.assign(new Error('Your account could not be found.'), { status: 401 });
};
const clearOtherDefaults = async (userId, resumeId, transaction) => {
    await Resume.update({ is_default: false }, { where: { user_id: userId, id: { [Op.ne]: resumeId }, is_default: true }, transaction });
};
const saveError = (res, err, message) => {
    console.error(message, err.message);
    const status = err.status || (err.name === 'SequelizeValidationError' ? 400 : 500);
    return res.status(status).json({ msg: status < 500 ? err.message : message, message: status < 500 ? err.message : message });
};

exports.createResume = async (req, res) => {
    if (!req.user?.id) return res.status(401).json({ msg: 'Unauthorized' });
    try {
        const body = req.body || {};
        const fields = mainResumeFields(body);
        const normalized = normalizeSections(body);
        const result = await db.sequelize.transaction(async (transaction) => {
            await lockResumeOwner(req.user.id, transaction);
            const draftId = fields.settings?.client_draft_id;
            if (draftId) {
                const owned = await Resume.findAll({ where: { user_id: req.user.id }, attributes: ['id', 'settings'], transaction });
                const existing = owned.find(row => {
                    let settings = row.settings;
                    if (typeof settings === 'string') { try { settings = JSON.parse(settings); } catch { return false; } }
                    return settings?.client_draft_id === draftId;
                });
                if (existing) return { resume: await Resume.findOne({ where: { id: existing.id, user_id: req.user.id }, transaction }), reused: true };
            }
            const resume = await Resume.create({ user_id: req.user.id, ...fields }, { transaction });
            if (resume.is_default) await clearOtherDefaults(req.user.id, resume.id, transaction);
            if (normalized.personalInfo === undefined) {
                const owner = await db.User.findByPk(req.user.id, { attributes: ['name', 'email'], include: [{ model: db.AlumniProfile }], transaction });
                normalized.personalInfo = { full_name: owner?.name || '', email: owner?.email || '', phone: owner?.AlumniProfile?.phone || '', address: owner?.AlumniProfile?.address || '', professional_title: owner?.AlumniProfile?.job_title || '', photo_url: owner?.AlumniProfile?.avatar_url || null };
            }
            await saveSections(resume.id, normalized, transaction);
            return { resume, reused: false };
        });
        return res.status(result.reused ? 200 : 201).json({ data: result.resume, reused: result.reused });
    } catch (err) { return saveError(res, err, 'Failed to create resume. Your changes were not saved.'); }
};

exports.updateResume = async (req, res) => {
    if (!req.user?.id) return res.status(401).json({ msg: 'Unauthorized' });
    try {
        const body = req.body || {};
        const fields = mainResumeFields(body);
        const normalized = normalizeSections(body);
        const resume = await db.sequelize.transaction(async (transaction) => {
            await lockResumeOwner(req.user.id, transaction);
            const record = await Resume.findOne({ where: { id: req.params.id, user_id: req.user.id }, transaction, lock: transaction.LOCK.UPDATE });
            if (!record) throw Object.assign(new Error('Resume not found.'), { status: 404 });
            // A draft key belongs to its original saved record and cannot be changed by later updates.
            if (fields.settings && record.settings?.client_draft_id) fields.settings.client_draft_id = record.settings.client_draft_id;
            if (fields.is_default) await clearOtherDefaults(req.user.id, record.id, transaction);
            await record.update(fields, { transaction });
            await saveSections(record.id, normalized, transaction);
            return record;
        });
        return res.json({ data: resume });
    } catch (err) { return saveError(res, err, 'Failed to update resume. Your changes were not saved.'); }
};

exports.deleteResume = async (req, res) => {
    try {
        const userId = req.user?.id;
        const resumeId = req.params.id;

        const resume = await Resume.findOne({ where: { id: resumeId, user_id: userId } });
        if (!resume) return res.status(404).json({ message: "Resume not found" });

        await resume.destroy();
        res.json({ message: "Resume deleted" });
    } catch (err) {
        console.error("deleteResume error:", err);
        res.status(500).json({ message: "Failed to delete resume" });
    }
};

exports.duplicateResume = async (req, res) => {
    if (!req.user?.id) return res.status(401).json({ msg: 'Unauthorized' });
    try {
        const copy = await db.sequelize.transaction(async (transaction) => {
            await lockResumeOwner(req.user.id, transaction);
            const source = await Resume.findOne({ where: { id: req.params.id, user_id: req.user.id }, transaction, lock: transaction.LOCK.UPDATE });
            if (!source) throw Object.assign(new Error('Resume not found.'), { status: 404 });
            const sourceSections = await readSections(source.id, transaction);
            const settings = typeof source.settings === 'string' ? JSON.parse(source.settings) : { ...source.settings };
            delete settings.client_draft_id;
            const duplicate = await Resume.create({ user_id: req.user.id, title: `${source.title} (Copy)`.slice(0, 255), template_id: source.template_id, font_family: source.font_family, font_size: source.font_size, line_spacing: source.line_spacing, color_theme: source.color_theme, settings, is_default: false }, { transaction });
            await saveSections(duplicate.id, normalizeSections(sourceSections), transaction);
            return duplicate;
        });
        return res.status(201).json({ data: copy });
    } catch (err) { return saveError(res, err, 'Failed to duplicate resume. No copy was saved.'); }
};

exports.getVersions = async (req, res) => {
    try {
        const userId = req.user?.id;
        const resumeId = req.params.id;

        const resume = await Resume.findOne({ where: { id: resumeId, user_id: userId } });
        if (!resume) return res.status(404).json({ message: "Resume not found" });

        const versions = await ResumeVersion.findAll({
            where: { resume_id: resumeId },
            order: [['version_number', 'DESC']]
        });

        res.json({ data: versions });
    } catch (err) {
        console.error("getVersions error:", err);
        res.status(500).json({ message: "Failed to fetch versions" });
    }
};

exports.getResumePdf = async (req, res) => {
    try {
        const userId = req.user?.id;
        const resumeId = req.params.id;

        const resume = await Resume.findOne({ where: { id: resumeId, user_id: userId } });
        if (!resume) return res.status(404).json({ message: "Resume not found" });

        const [personalInfo, summary, education, workExperience, skills, projects, certifications,
            trainings, seminars, awards, organizations, volunteerWork, languages, references] = await Promise.all([
                ResumePersonalInfo.findOne({ where: { resume_id: resumeId } }),
                ResumeSummary.findOne({ where: { resume_id: resumeId } }),
                ResumeEducation.findAll({ where: { resume_id: resumeId }, order: [['sort_order', 'ASC'], ['id', 'ASC']] }),
                ResumeWorkExperience.findAll({ where: { resume_id: resumeId }, order: [['sort_order', 'ASC'], ['id', 'ASC']] }),
                ResumeSkill.findAll({ where: { resume_id: resumeId }, order: [['sort_order', 'ASC'], ['id', 'ASC']] }),
                ResumeProject.findAll({ where: { resume_id: resumeId }, order: [['sort_order', 'ASC'], ['id', 'ASC']] }),
                ResumeCertification.findAll({ where: { resume_id: resumeId }, order: [['sort_order', 'ASC'], ['id', 'ASC']] }),
                ResumeTraining.findAll({ where: { resume_id: resumeId }, order: [['sort_order', 'ASC'], ['id', 'ASC']] }),
                ResumeSeminar.findAll({ where: { resume_id: resumeId }, order: [['sort_order', 'ASC'], ['id', 'ASC']] }),
                ResumeAward.findAll({ where: { resume_id: resumeId }, order: [['sort_order', 'ASC'], ['id', 'ASC']] }),
                ResumeOrganization.findAll({ where: { resume_id: resumeId }, order: [['sort_order', 'ASC'], ['id', 'ASC']] }),
                ResumeVolunteerWork.findAll({ where: { resume_id: resumeId }, order: [['sort_order', 'ASC'], ['id', 'ASC']] }),
                ResumeLanguage.findAll({ where: { resume_id: resumeId }, order: [['sort_order', 'ASC'], ['id', 'ASC']] }),
                ResumeReference.findAll({ where: { resume_id: resumeId }, order: [['sort_order', 'ASC'], ['id', 'ASC']] })
            ]);

        const data = {
            resume,
            personalInfo: personalInfo || {},
            summary: summary || {},
            education: education || [],
            workExperience: workExperience || [],
            skills: skills || [],
            projects: projects || [],
            certifications: certifications || [],
            trainings: trainings || [],
            seminars: seminars || [],
            awards: awards || [],
            organizations: organizations || [],
            volunteerWork: volunteerWork || [],
            languages: languages || [],
            references: references || []
        };

        // Return JSON data — frontend will handle PDF generation client-side
        res.json({ data });
    } catch (err) {
        console.error("getResumePdf error:", err);
        res.status(500).json({ message: "Failed to generate resume" });
    }
};

exports.exportResumePdf = async (req, res) => {
    if (!req.user?.id) return res.status(401).json({ msg: "Unauthorized" });
    try {
        const resume = await Resume.findOne({ where: { id: req.params.id, user_id: req.user.id } });
        if (!resume) return res.status(404).json({ msg: "Resume not found." });
        const templateId = normalizeTemplateId(resume.template_id);
        if (req.body?.template_id !== templateId) return res.status(409).json({ msg: "Save the selected template before exporting it." });
        const pdfService = require("../services/resumePdf");
        pdfService.validateResumeHtml(req.body.html, resume.id, templateId);
        const pdf = await pdfService.renderResumePdf(req.body.html);
        const filename = String(resume.title || "Resume").replace(/[^a-zA-Z0-9 _.-]/g, "_").slice(0, 100) || "Resume";
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}.pdf"`);
        res.setHeader("Cache-Control", "private, no-store");
        return res.send(pdf);
    } catch (err) {
        console.error("Resume PDF export failed:", err.message);
        return res.status(err.status || 500).json({ msg: err.status ? err.message : "Unable to generate your PDF. Please try again or use Print Resume." });
    }
};

exports.createSnapshot = async (req, res) => {
    try {
        const userId = req.user?.id;
        const resumeId = req.params.id;
        const { change_summary } = req.body;

        const resume = await Resume.findOne({ where: { id: resumeId, user_id: userId } });
        if (!resume) return res.status(404).json({ message: "Resume not found" });

        // Gather full resume data for snapshot
        const [personalInfo, summary, education, workExperience, skills, projects, certifications,
            trainings, seminars, awards, organizations, volunteerWork, languages, references] = await Promise.all([
                ResumePersonalInfo.findOne({ where: { resume_id: resumeId } }),
                ResumeSummary.findOne({ where: { resume_id: resumeId } }),
                ResumeEducation.findAll({ where: { resume_id: resumeId } }),
                ResumeWorkExperience.findAll({ where: { resume_id: resumeId } }),
                ResumeSkill.findAll({ where: { resume_id: resumeId } }),
                ResumeProject.findAll({ where: { resume_id: resumeId } }),
                ResumeCertification.findAll({ where: { resume_id: resumeId } }),
                ResumeTraining.findAll({ where: { resume_id: resumeId } }),
                ResumeSeminar.findAll({ where: { resume_id: resumeId } }),
                ResumeAward.findAll({ where: { resume_id: resumeId } }),
                ResumeOrganization.findAll({ where: { resume_id: resumeId } }),
                ResumeVolunteerWork.findAll({ where: { resume_id: resumeId } }),
                ResumeLanguage.findAll({ where: { resume_id: resumeId } }),
                ResumeReference.findAll({ where: { resume_id: resumeId } })
            ]);

        const snapshotData = {
            resume: resume.toJSON(),
            personalInfo: personalInfo?.toJSON(),
            summary: summary?.toJSON(),
            education: education.map(e => e.toJSON()),
            workExperience: workExperience.map(e => e.toJSON()),
            skills: skills.map(e => e.toJSON()),
            projects: projects.map(e => e.toJSON()),
            certifications: certifications.map(e => e.toJSON()),
            trainings: trainings.map(e => e.toJSON()),
            seminars: seminars.map(e => e.toJSON()),
            awards: awards.map(e => e.toJSON()),
            organizations: organizations.map(e => e.toJSON()),
            volunteerWork: volunteerWork.map(e => e.toJSON()),
            languages: languages.map(e => e.toJSON()),
            references: references.map(e => e.toJSON())
        };

        const versions = await ResumeVersion.findAll({ where: { resume_id: resumeId } });
        const nextVersion = versions.length > 0 ? Math.max(...versions.map(v => v.version_number)) + 1 : 1;

        const version = await ResumeVersion.create({
            resume_id: resumeId,
            version_number: nextVersion,
            snapshot_data: snapshotData,
            change_summary: change_summary || 'Manual save'
        });

        res.status(201).json({ data: version });
    } catch (err) {
        console.error("createSnapshot error:", err);
        res.status(500).json({ message: "Failed to create version snapshot" });
    }
};
