import { EMPLOYMENT_TYPE_OPTIONS } from "./employmentTypes.js";

export const WORK_SETUP_OPTIONS = [{ value: "on-site", label: "On-site" }, { value: "hybrid", label: "Hybrid" }, { value: "remote", label: "Remote" }];
export const GOVERNMENT_BENEFITS = ["SSS", "PhilHealth", "Pag-IBIG"];
export const ADDITIONAL_BENEFITS = ["Leave Benefits", "Paid Holidays", "Performance Incentives", "Training Opportunities", "Career Development"];
export const cleanPostingList = (value) => Array.isArray(value) ? value.filter(item => typeof item === "string").map(item => item.trim()).filter(Boolean) : [];
const text = (value) => typeof value === "string" ? value.trim() : "";
const nullableNumber = (value) => value === "" || value === null || value === undefined ? null : Number(value);

export function createJobPostingForm() {
    return {
        title: "", description: "", location: "", employment_type: "full-time", course_target: "", expected_salary: "", interview_details: null,
        posting_details: {
            work_setup: "on-site", vacancy_count: "", industry: "", company_description: "", responsibilities: [],
            required_qualifications: { education: "", experience: "", skills: [], other: [], preferred_start_date: "" },
            preferred_qualifications: [], compensation: { min: "", max: "", period: "monthly", display: "negotiable" },
            benefits: { government: [], additional: [], other: [] },
            application: { deadline: "", method: "portal", publish_contact: false, contact_email: "", contact_number: "", walk_in_address: "", office_hours: "", instructions: "" }
        }
    };
}

export function postingDetailsOf(job) {
    let details = job?.posting_details;
    if (typeof details === "string") {
        try { details = JSON.parse(details); } catch { return null; }
    }
    return details && typeof details === "object" && !Array.isArray(details) ? details : null;
}

export function jobCompanyName(job, profile) {
    const owner = profile || job?.User || job?.employer || {};
    return text(owner.EmployerProfile?.organization_name) || text(owner.admin_organization) || text(owner.name) || "";
}

export function salaryDisplay(compensation, legacySalary = "") {
    if (!compensation || typeof compensation !== "object") return text(legacySalary);
    if (compensation.display === "negotiable") return "Negotiable";
    if (compensation.display === "based-on-experience") return "Based on Experience";
    const min = nullableNumber(compensation.min), max = nullableNumber(compensation.max);
    const currency = (amount) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 2 }).format(amount);
    const period = { monthly: "month", daily: "day", hourly: "hour" }[compensation.period];
    const suffix = period ? ` per ${period}` : "";
    if (min !== null && max !== null && Number.isFinite(min) && Number.isFinite(max)) return `${currency(min)} – ${currency(max)}${suffix}`;
    if (min !== null && Number.isFinite(min)) return `From ${currency(min)}${suffix}`;
    if (max !== null && Number.isFinite(max)) return `Up to ${currency(max)}${suffix}`;
    return text(legacySalary);
}

export function validateJobPosting(form, requirements = []) {
    const errors = [];
    if (!text(form?.title)) errors.push("Job Title is required.");
    if (!text(form?.location)) errors.push("Job Location is required.");
    if (!text(form?.description)) errors.push("Job Description is required.");
    if (!EMPLOYMENT_TYPE_OPTIONS.some(option => option.value === form?.employment_type)) errors.push("Select a valid Employment Type.");
    const details = postingDetailsOf(form);
    if (!details) { errors.push("Complete the job posting details."); return errors; }
    if (!WORK_SETUP_OPTIONS.some(option => option.value === details.work_setup)) errors.push("Select a valid Work Setup.");
    const vacancies = nullableNumber(details.vacancy_count);
    if (vacancies !== null && (!Number.isSafeInteger(vacancies) || vacancies < 1 || vacancies > 100000)) errors.push("Vacancies must be a positive whole number up to 100,000.");
    const application = details.application || {};
    const validDate = (value) => !value || (/^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value);
    for (const [name, value] of [["Application Deadline", application.deadline], ["Preferred Start Date", details.required_qualifications?.preferred_start_date]]) {
        try { if (!validDate(value)) errors.push(`${name} must be a valid date.`); } catch { errors.push(`${name} must be a valid date.`); }
    }
    if (application.publish_contact === true && application.contact_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(application.contact_email)) errors.push("Contact Email must be a valid email address.");
    if (!Array.isArray(requirements) || requirements.length === 0) errors.push("Add at least one application requirement before publishing.");
    const requirementCodes = new Set();
    for (const [index, requirement] of (Array.isArray(requirements) ? requirements : []).entries()) {
        if (!text(requirement.label)) errors.push(`Application requirement ${index + 1} needs a label.`);
        if (!["document_upload", "information_field"].includes(requirement.requirement_type)) errors.push(`Application requirement ${index + 1} has an invalid type.`);
        if (!requirement.requirement_code || requirementCodes.has(requirement.requirement_code)) errors.push("Application requirements must have unique identifiers.");
        requirementCodes.add(requirement.requirement_code);
    }
    return errors;
}

export function jobPostingPayload(form, requirements) {
    const details = postingDetailsOf(form) || createJobPostingForm().posting_details;
    const qualification = details.required_qualifications || {};
    const application = details.application || {};
    const posting = {
        work_setup: details.work_setup, vacancy_count: nullableNumber(details.vacancy_count), industry: text(details.industry), company_description: text(details.company_description),
        responsibilities: cleanPostingList(details.responsibilities),
        required_qualifications: { education: text(qualification.education), experience: text(qualification.experience), skills: cleanPostingList(qualification.skills), other: cleanPostingList(qualification.other), preferred_start_date: text(qualification.preferred_start_date) },
        preferred_qualifications: cleanPostingList(details.preferred_qualifications),
        compensation: { min: details.compensation?.display === "range" ? nullableNumber(details.compensation?.min) : null, max: details.compensation?.display === "range" ? nullableNumber(details.compensation?.max) : null, period: details.compensation?.period || "monthly", display: details.compensation?.display || "negotiable" },
        benefits: { government: cleanPostingList(details.benefits?.government), additional: cleanPostingList(details.benefits?.additional), other: cleanPostingList(details.benefits?.other) },
        application: { deadline: text(application.deadline) || null, method: "portal", publish_contact: application.publish_contact === true, contact_email: application.publish_contact === true ? text(application.contact_email) : "", contact_number: application.publish_contact === true ? text(application.contact_number) : "", walk_in_address: application.publish_contact === true ? text(application.walk_in_address) : "", office_hours: application.publish_contact === true ? text(application.office_hours) : "", instructions: text(application.instructions) }
    };
    return {
        title: text(form.title), description: text(form.description), location: text(form.location), employment_type: form.employment_type,
        course_target: text(form.course_target), expected_salary: salaryDisplay(posting.compensation), posting_details: posting,
        interview_details: form.interview_details,
        requirements: requirements.map((requirement, index) => ({
            requirement_code: requirement.requirement_code, label: text(requirement.label), requirement_type: requirement.requirement_type,
            value_type: requirement.requirement_type === "document_upload" ? "file" : (requirement.value_type === "file" ? "text" : requirement.value_type || "text"),
            required: requirement.required, is_custom: requirement.is_custom, library_code: requirement.library_code,
            allowed_types: requirement.allowed_types, max_file_size: requirement.max_file_size, sort_order: index, group_temp_id: null
        }))
    };
}
