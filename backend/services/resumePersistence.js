const db = require("../models");

// Canonical database columns, with aliases accepted from older resume clients.
const sections = {
    personalInfo: { model: "ResumePersonalInfo", one: true, fields: ["full_name", "professional_title", "email", "phone", "address", "linkedin", "github", "portfolio", "website", "photo_url"] },
    summary: { model: "ResumeSummary", one: true, fields: ["content"] },
    education: { model: "ResumeEducation", fields: ["institution", "degree", "field_of_study", "start_date", "end_date", "is_current", "gpa", "description", "sort_order"], aliases: { institution: ["school"], is_current: ["current"] } },
    workExperience: { model: "ResumeWorkExperience", fields: ["job_title", "company", "location", "start_date", "end_date", "is_current", "description", "sort_order"], aliases: { is_current: ["current"] } },
    skills: { model: "ResumeSkill", fields: ["skill_name", "category", "sort_order"], aliases: { skill_name: ["name"] } },
    projects: { model: "ResumeProject", fields: ["project_name", "description", "technologies", "url", "start_date", "end_date", "is_current", "sort_order"], aliases: { project_name: ["name"], is_current: ["current"] } },
    certifications: { model: "ResumeCertification", fields: ["name", "issuer", "issue_date", "expiry_date", "credential_id", "url", "sort_order"], aliases: { issue_date: ["date"] } },
    trainings: { model: "ResumeTraining", fields: ["training_name", "provider", "completion_date", "description", "sort_order"], aliases: { training_name: ["title"], completion_date: ["end_date", "start_date"] } },
    seminars: { model: "ResumeSeminar", fields: ["seminar_name", "organizer", "date", "location", "description", "sort_order"], aliases: { seminar_name: ["title"] } },
    awards: { model: "ResumeAward", fields: ["title", "issuer", "date", "description", "sort_order"] },
    organizations: { model: "ResumeOrganization", fields: ["organization_name", "position", "start_date", "end_date", "is_current", "description", "sort_order"], aliases: { organization_name: ["name"], position: ["role"], is_current: ["current"] } },
    volunteerWork: { model: "ResumeVolunteerWork", fields: ["organization", "role", "start_date", "end_date", "is_current", "description", "sort_order"], aliases: { is_current: ["current"] } },
    languages: { model: "ResumeLanguage", fields: ["language", "proficiency", "sort_order"], aliases: { language: ["name"] } },
    references: { model: "ResumeReference", fields: ["name", "relationship", "company", "email", "phone", "sort_order"], aliases: { relationship: ["position"] } }
};

const badRequest = (message) => Object.assign(new Error(message), { status: 400 });
const toPlain = (value) => value?.toJSON ? value.toJSON() : value;

function normalizeItem(section, item, index) {
    const definition = sections[section];
    if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw badRequest(`Invalid ${section} entry.`);
    }
    const normalized = {};
    for (const field of definition.fields) {
        const keys = [field, ...(definition.aliases?.[field] || [])];
        const key = keys.find((candidate) => item[candidate] !== undefined);
        if (key === undefined) continue;
        let value = item[key];
        if (field === "photo_url" && typeof value === "string" && /^blob:/i.test(value)) {
            throw badRequest("Temporary browser photo URLs cannot be saved. Upload the photo again.");
        }
        if (field.endsWith("_date") || field === "date") {
            if (!value) value = null;
            else if (Number.isNaN(new Date(value).getTime())) throw badRequest(`Invalid date in ${section}.`);
        }
        if (field === "is_current") value = value === true || value === 1 || value === "true" || value === "1";
        normalized[field] = value;
    }
    if (!definition.one && normalized.sort_order === undefined) normalized.sort_order = index + 1;
    if (section === "skills") {
        if (typeof normalized.skill_name !== "string" || !normalized.skill_name.trim()) throw badRequest("Enter a name for every skill.");
        normalized.skill_name = normalized.skill_name.trim();
        if (normalized.skill_name.length > 255) throw badRequest("Skill names must be 255 characters or fewer.");
        if (normalized.category != null) {
            if (typeof normalized.category !== "string") throw badRequest("Skill categories must be text.");
            normalized.category = normalized.category.trim();
            if (normalized.category.length > 100) throw badRequest("Category names must be 100 characters or fewer.");
        }
    }
    return normalized;
}

function normalizeSections(body) {
    const normalized = {};
    for (const [key, definition] of Object.entries(sections)) {
        if (body[key] === undefined) continue;
        if (definition.one) {
            normalized[key] = normalizeItem(key, body[key], 0);
        } else {
            if (!Array.isArray(body[key])) throw badRequest(`${key} must be a list.`);
            normalized[key] = body[key].map((item, index) => normalizeItem(key, item, index));
            if (key === "skills") {
                const seen = new Set();
                for (const item of normalized[key]) {
                    const category = String(item.category || "").toLowerCase();
                    const identity = JSON.stringify([category === "uncategorized" ? "" : category, item.skill_name.toLowerCase()]);
                    if (seen.has(identity)) throw badRequest("This skill already exists in that category.");
                    seen.add(identity);
                }
            }
        }
    }
    return normalized;
}

function normalizeSkillCategories(categories) {
    if (!Array.isArray(categories)) throw badRequest("Skill categories must be a list.");
    const seen = new Set();
    return categories.map(category => {
        if (typeof category !== "string" || !category.trim()) throw badRequest("Enter a category name.");
        const name = category.trim();
        if (name.length > 100) throw badRequest("Category names must be 100 characters or fewer.");
        const key = name.toLowerCase();
        if (key === "uncategorized") throw badRequest("Uncategorized is reserved for skills without a category.");
        if (seen.has(key)) throw badRequest("This skill category already exists.");
        seen.add(key);
        return name;
    });
}

async function saveSections(resumeId, normalized, transaction) {
    for (const [key, value] of Object.entries(normalized)) {
        const definition = sections[key];
        const Model = db[definition.model];
        if (definition.one) {
            const existing = await Model.findOne({ where: { resume_id: resumeId }, transaction });
            if (existing) await existing.update(value, { transaction });
            else await Model.create({ ...value, resume_id: resumeId }, { transaction });
        } else {
            await Model.destroy({ where: { resume_id: resumeId }, transaction });
            if (value.length) await Model.bulkCreate(value.map((item) => ({ ...item, resume_id: resumeId })), { transaction, validate: true });
        }
    }
}

async function readSections(resumeId, transaction) {
    const entries = await Promise.all(Object.entries(sections).map(async ([key, definition]) => {
        const options = { where: { resume_id: resumeId }, ...(transaction && { transaction }) };
        const Model = db[definition.model];
        const value = definition.one
            ? await Model.findOne(options)
            : await Model.findAll({ ...options, order: [["sort_order", "ASC"], ["id", "ASC"]] });
        return [key, definition.one ? toPlain(value) || {} : value.map(toPlain)];
    }));
    return Object.fromEntries(entries);
}

const templateIds = ["modern-professional", "executive-corporate", "university-green", "minimal-black-white", "creative-professional"];
function normalizeTemplateId(value, fallback = "university-green") {
    const key = String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
    const aliases = { universitygreentheme: "university-green", minimalblackandwhite: "minimal-black-white" };
    return templateIds.find((id) => id.replace(/-/g, "") === key) || aliases[key] || fallback;
}

module.exports = { sections, normalizeSections, saveSections, readSections, toPlain, badRequest, normalizeTemplateId, normalizeSkillCategories };
