const text = value => value === null || value === undefined ? "" : String(value).trim();
const first = (...values) => values.map(text).find(Boolean) || "";
const joined = (...values) => values.map(text).filter(Boolean).join(" · ");

export function formatResumeDate(value) {
    const raw = text(value);
    if (!raw) return "";
    const match = raw.match(/^(\d{4})-(\d{2})(?:-\d{2})?(?:T.*)?$/);
    if (!match) return raw;
    const month = Number(match[2]);
    if (month < 1 || month > 12) return raw;
    return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][month - 1]} ${match[1]}`;
}

function dateRange(entry) {
    const start = formatResumeDate(entry.start_date);
    const end = entry.is_current || entry.current ? "Present" : formatResumeDate(entry.end_date);
    return [start, end].filter(Boolean).join(" – ");
}

function orderedEntries(items, mapper) {
    if (!Array.isArray(items)) return [];
    return items.filter(item => item && typeof item === "object")
        .map((item, index) => ({ item, index }))
        .sort((a, b) => (Number(a.item.sort_order) || a.index + 1) - (Number(b.item.sort_order) || b.index + 1))
        .map(({ item }) => mapper(item))
        .filter(item => item.title || item.subtitle || item.meta || item.description || item.details?.some(Boolean));
}

export function createResumeSections(resume = {}) {
    const sections = [];
    const add = (id, title, items, kind = "entries") => { if (items.length) sections.push({ id, title, items, kind }); };
    const summary = text(typeof resume.summary === "string" ? resume.summary : resume.summary?.content);
    if (summary) add("summary", "Professional Summary", [{ description: summary }]);
    add("workExperience", "Work Experience", orderedEntries(resume.workExperience, e => ({ title: text(e.job_title), subtitle: text(e.company), meta: joined(dateRange(e), e.location), description: text(e.description) })));
    add("education", "Education", orderedEntries(resume.education, e => ({ title: [text(e.degree), text(e.field_of_study)].filter(Boolean).join(e.degree ? " in " : ""), subtitle: first(e.institution, e.school), meta: joined(dateRange(e), e.gpa ? `GPA: ${e.gpa}` : ""), description: text(e.description) })));
    add("skills", "Skills", orderedEntries(resume.skills, e => ({ title: first(e.skill_name, e.name), subtitle: text(e.category) })), "skills");
    add("projects", "Projects", orderedEntries(resume.projects, e => ({ title: first(e.project_name, e.name), meta: dateRange(e), description: text(e.description), details: [e.technologies ? `Technologies: ${text(e.technologies)}` : "", text(e.url)] })));
    add("certifications", "Certifications", orderedEntries(resume.certifications, e => ({ title: text(e.name), subtitle: text(e.issuer), meta: joined(formatResumeDate(e.issue_date || e.date), e.expiry_date ? `Expires ${formatResumeDate(e.expiry_date)}` : ""), details: [e.credential_id ? `Credential: ${text(e.credential_id)}` : "", text(e.url)] })));
    add("trainings", "Trainings", orderedEntries(resume.trainings, e => ({ title: first(e.training_name, e.title), subtitle: text(e.provider), meta: first(formatResumeDate(e.completion_date), dateRange(e)), description: text(e.description) })));
    add("seminars", "Seminars", orderedEntries(resume.seminars, e => ({ title: first(e.seminar_name, e.title), subtitle: text(e.organizer), meta: joined(formatResumeDate(e.date), e.location), description: text(e.description) })));
    add("awards", "Awards & Honors", orderedEntries(resume.awards, e => ({ title: text(e.title), subtitle: text(e.issuer), meta: formatResumeDate(e.date), description: text(e.description) })));
    add("languages", "Languages", orderedEntries(resume.languages, e => ({ title: first(e.language, e.name), subtitle: text(e.proficiency) })), "languages");
    add("organizations", "Organizations", orderedEntries(resume.organizations, e => ({ title: first(e.organization_name, e.name), subtitle: first(e.position, e.role), meta: dateRange(e), description: text(e.description) })));
    add("volunteerWork", "Volunteer Work", orderedEntries(resume.volunteerWork, e => ({ title: first(e.organization, e.name), subtitle: text(e.role), meta: dateRange(e), description: text(e.description) })));
    add("references", "References", orderedEntries(resume.references, e => ({ title: text(e.name), subtitle: joined(first(e.relationship, e.position), e.company), details: [joined(e.email, e.phone)] })));
    return sections;
}

export function getResumeDocumentStyle(resume = {}) {
    const fontSize = Number(resume.font_size);
    const lineSpacing = Number(resume.line_spacing);
    const font = text(resume.font_family).replace(/[;{}<>\\]/g, "");
    return {
        "--resume-font-size": `${Number.isFinite(fontSize) && fontSize > 0 ? Math.min(14, Math.max(8, fontSize)) : 10.5}pt`,
        "--resume-line-height": Number.isFinite(lineSpacing) && lineSpacing > 0 ? Math.min(2, Math.max(1.15, lineSpacing)) : 1.45,
        ...(font ? { "--resume-font-family": font } : {}),
        ...(typeof resume.color_theme === "string" && /^#[0-9a-f]{6}$/i.test(resume.color_theme) ? { "--resume-accent": resume.color_theme } : {})
    };
}
