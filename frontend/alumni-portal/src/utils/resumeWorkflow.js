import { normalizeTemplateId } from "../components/resume/templates/resumeTemplateConfig.js";
import { validateResumeSkills } from "./resumeSkills.js";

export const RESUME_LIST_SECTIONS = [
    "education", "workExperience", "skills", "projects", "certifications", "trainings",
    "seminars", "awards", "organizations", "volunteerWork", "languages", "references"
];

const resumeFields = ["title", "template_id", "font_family", "font_size", "line_spacing",
    "color_theme", "settings", "is_default", "personalInfo", "summary", ...RESUME_LIST_SECTIONS];

export function unwrapResume(response) {
    const record = response?.data?.id ? response.data : response;
    if (!record || !record.id || typeof record !== "object") {
        throw new Error("The server returned an invalid resume. Please try again.");
    }
    return normalizeResume(record);
}

export function unwrapResumeList(response) {
    const records = Array.isArray(response) ? response : response?.data;
    if (!Array.isArray(records)) throw new Error("The server returned an invalid resume list.");
    return records.filter(record => record && record.id && !record.is_archived);
}

export function normalizeResume(resume = {}) {
    const info = Array.isArray(resume.personalInfo) ? resume.personalInfo[0] : resume.personalInfo;
    const summary = Array.isArray(resume.summary) ? resume.summary[0] : resume.summary;
    let settings = resume.settings || {};
    if (typeof settings === "string") {
        try { settings = JSON.parse(settings); } catch { settings = {}; }
    }
    const normalized = {
        ...resume,
        title: resume.title || "My Resume",
        template_id: normalizeTemplateId(resume.template_id),
        settings: settings && typeof settings === "object" && !Array.isArray(settings) ? settings : {},
        personalInfo: info && typeof info === "object" ? { ...info } : {},
        summary: summary && typeof summary === "object" ? { ...summary } : {}
    };
    for (const section of RESUME_LIST_SECTIONS) {
        normalized[section] = Array.isArray(resume[section]) ? resume[section].filter(Boolean).map(item => {
            const entry = { ...item };
            for (const field of ["start_date", "end_date", "date", "issue_date", "expiry_date", "completion_date"]) {
                if (typeof entry[field] === "string" && /^\d{4}-\d{2}-\d{2}T/.test(entry[field])) entry[field] = entry[field].slice(0, 10);
            }
            return entry;
        }) : [];
    }
    normalized.organizations = normalized.organizations.map(item => ({ ...item, organization_name: item.organization_name ?? item.name ?? "" }));
    return normalized;
}

export function createResumeDraft(profile = {}, draftId) {
    const user = profile.user || profile;
    const alumni = user.AlumniProfile || profile.AlumniProfile || {};
    return normalizeResume({
        title: "My Resume", template_id: "modern-professional", is_default: false,
        font_size: 11, line_spacing: 1.45, color_theme: "#065845", font_family: "Arial, sans-serif",
        settings: { client_draft_id: draftId },
        personalInfo: {
            full_name: user.name || "", email: user.email || "",
            phone: alumni.phone || user.phone || "", address: alumni.address || "",
            professional_title: alumni.job_title || "", photo_url: alumni.avatar_url || null
        }
    });
}

export function validateResume(resume) {
    const errors = {};
    const info = resume?.personalInfo || {};
    if (!String(info.full_name || "").trim()) errors.full_name = "Enter your full name.";
    const email = String(info.email || "").trim();
    if (!email) errors.email = "Enter your email address.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = "Enter a valid email address.";
    const skillError = validateResumeSkills(resume?.skills || []);
    if (skillError) errors.skills = skillError;
    return errors;
}

export function resumePayload(resume) {
    const normalized = normalizeResume(resume);
    const payload = Object.fromEntries(resumeFields.map(field => [field, normalized[field]]).filter(([, value]) => value !== undefined));
    payload.personalInfo = {
        ...payload.personalInfo,
        full_name: String(payload.personalInfo.full_name || "").trim(),
        email: String(payload.personalInfo.email || "").trim()
    };
    return payload;
}

export function resumeFingerprint(resume) {
    return resume ? JSON.stringify(resumePayload(resume)) : "";
}

/** Remember a newly acknowledged ID before reloading, so a failed reload can safely retry PUT. */
export async function persistResume({ api, resume, onIdentified = () => {} }) {
    const errors = validateResume(resume);
    if (Object.keys(errors).length) throw new Error("Complete the required personal information before saving.");
    const payload = resumePayload(resume);
    let id = resume.id;
    if (id) {
        await api.put(`/resumes/${id}`, payload, true);
    } else {
        const creation = await api.post("/resumes", payload, true);
        const created = unwrapResume(creation);
        id = created.id;
        onIdentified(id);
        // A lost create response may be retried after further edits.
        if (creation.reused) await api.put(`/resumes/${id}`, payload, true);
    }
    const saved = unwrapResume(await api.get(`/resumes/${id}`, true));
    if (String(saved.id) !== String(id)) throw new Error("The saved resume could not be verified. Please reload it.");
    return saved;
}

export function restoreResumeDraft(raw, userId, records) {
    try {
        const cached = JSON.parse(raw || "null");
        if (cached?.version !== 1 || String(cached.userId) !== String(userId) || !cached.resume || typeof cached.resume !== "object") return null;
        if (cached.resume.id && !records.some(record => String(record.id) === String(cached.resume.id))) return null;
        return normalizeResume(cached.resume);
    } catch { return null; }
}

export function resumeCompletion(resume) {
    const pi = resume?.personalInfo || {};
    let score = [pi.full_name, pi.email, pi.phone, pi.address].filter(Boolean).length * 5;
    if (resume?.summary?.content) score += 10;
    if (resume?.education?.length) score += 15;
    if (resume?.workExperience?.length) score += 20;
    if (resume?.skills?.length) score += 15;
    score += RESUME_LIST_SECTIONS.slice(3).filter(section => resume?.[section]?.length).length / 9 * 20;
    return Math.round(score);
}
