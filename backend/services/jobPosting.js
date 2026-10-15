"use strict";

class JobPostingError extends Error {
    constructor(message, status = 400) { super(message); this.status = status; }
}
const fail = message => { throw new JobPostingError(message); };
const object = (value, label) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object.`);
    return value;
};
const text = (value, label, max = 500, required = false) => {
    if (value == null) value = "";
    if (typeof value !== "string") fail(`${label} must be text.`);
    const result = value.trim();
    if (required && !result) fail(`${label} is required.`);
    if (result.length > max) fail(`${label} must not exceed ${max} characters.`);
    return result;
};
const list = (value, label) => {
    if (value == null) return [];
    if (!Array.isArray(value) || value.length > 100) fail(`${label} must contain at most 100 entries.`);
    return value.map(item => text(item, label, 1000)).filter(Boolean);
};
const choice = (value, choices, label, fallback) => {
    const result = value == null || value === "" ? fallback : value;
    if (!choices.includes(result)) fail(`${label} must be one of: ${choices.join(", ")}.`);
    return result;
};
const number = (value, label) => {
    if (value == null || value === "") return null;
    if (!["number", "string"].includes(typeof value) || (typeof value === "string" && !/^\d+(?:\.\d{1,2})?$/.test(value.trim()))) fail(`${label} must be a non-negative amount with at most two decimal places.`);
    const result = Number(value);
    if (!Number.isFinite(result) || result < 0 || result > 100000000000 || Math.abs(Math.round(result * 100) - result * 100) > 0.00001) fail(`${label} must be a non-negative amount with at most two decimal places.`);
    return result;
};
const date = (value, label) => {
    const result = text(value, label, 10);
    if (!result) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) fail(`${label} must be a valid date.`);
    const parsed = new Date(`${result}T00:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== result) fail(`${label} must be a valid date.`);
    return result;
};

function normalizePostingDetails(value) {
    const input = object(value, "Posting details");
    const vacancy = input.vacancy_count == null || input.vacancy_count === "" ? null : Number(input.vacancy_count);
    if (vacancy !== null && (!["number", "string"].includes(typeof input.vacancy_count) || !Number.isInteger(vacancy) || vacancy < 1 || vacancy > 100000)) fail("Number of vacancies must be a positive integer up to 100000.");
    const qualifications = object(input.required_qualifications || {}, "Required qualifications");
    const salary = object(input.compensation || {}, "Compensation");
    const min = number(salary.min, "Salary minimum");
    const max = number(salary.max, "Salary maximum");
    if (min !== null && max !== null && max < min) fail("Salary maximum must be greater than or equal to salary minimum.");
    const display = choice(salary.display, ["range", "negotiable", "based-on-experience"], "Salary display", "negotiable");
    if (display === "range" && min === null && max === null) fail("Enter a salary minimum or maximum, or choose Negotiable or Based on Experience.");
    const benefits = object(input.benefits || {}, "Benefits");
    const government = list(benefits.government, "Government benefits");
    if (government.some(item => !["SSS", "PhilHealth", "Pag-IBIG"].includes(item))) fail("Government benefits contain an unsupported option.");
    const application = object(input.application || {}, "Application settings");
    if (application.publish_contact !== undefined && typeof application.publish_contact !== "boolean") fail("Publish contact details must be true or false.");
    const publishContact = application.publish_contact === true;
    const email = publishContact ? text(application.contact_email, "Contact email", 254) : "";
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("Contact email must be a valid email address.");
    return {
        work_setup: choice(input.work_setup, ["on-site", "hybrid", "remote"], "Work setup"),
        vacancy_count: vacancy,
        industry: text(input.industry, "Industry", 255),
        company_description: text(input.company_description, "About the company", 20000),
        responsibilities: list(input.responsibilities, "Responsibilities"),
        required_qualifications: {
            education: text(qualifications.education, "Education", 2000),
            experience: text(qualifications.experience, "Experience", 2000),
            skills: list(qualifications.skills, "Skills"),
            other: list(qualifications.other, "Other qualifications"),
            preferred_start_date: date(qualifications.preferred_start_date, "Preferred start date") || ""
        },
        preferred_qualifications: list(input.preferred_qualifications, "Preferred qualifications"),
        compensation: { min, max, period: choice(salary.period, ["monthly", "daily", "hourly"], "Salary period", "monthly"), display },
        benefits: { government, additional: list(benefits.additional, "Additional benefits"), other: list(benefits.other, "Other benefits") },
        application: {
            deadline: date(application.deadline, "Application deadline"),
            method: choice(application.method, ["portal"], "Application method", "portal"),
            publish_contact: publishContact,
            contact_email: email,
            contact_number: publishContact ? text(application.contact_number, "Contact number", 100) : "",
            walk_in_address: publishContact ? text(application.walk_in_address, "Walk-in address", 2000) : "",
            office_hours: publishContact ? text(application.office_hours, "Office hours", 500) : "",
            instructions: text(application.instructions, "Application instructions", 10000)
        }
    };
}

function salaryLabel(details) {
    const salary = details.compensation;
    if (salary.display === "negotiable") return "Negotiable";
    if (salary.display === "based-on-experience") return "Based on Experience";
    const amount = value => `PHP ${Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
    const range = salary.min !== null && salary.max !== null ? `${amount(salary.min)} – ${amount(salary.max)}` : salary.min !== null ? `From ${amount(salary.min)}` : `Up to ${amount(salary.max)}`;
    return `${range} / ${salary.period}`;
}

function validateRequirements(requirements, groups) {
    if (requirements !== undefined && (!Array.isArray(requirements) || requirements.length > 100)) fail("Application requirements must contain at most 100 entries.");
    if (groups !== undefined && (!Array.isArray(groups) || groups.length > 100)) fail("Requirement groups must contain at most 100 entries.");
    for (const requirement of requirements || []) {
        object(requirement, "Application requirement");
        text(requirement.label, "Requirement label", 255, true);
        text(requirement.description, "Requirement description", 10000);
        choice(requirement.requirement_type, ["document_upload", "information_field"], "Requirement type", "document_upload");
        if (requirement.required !== undefined && typeof requirement.required !== "boolean") fail("Requirement required setting must be true or false.");
        // Preserve the existing storage units; do not reinterpret metadata as MB.
        if (requirement.max_file_size != null && (!Number.isInteger(Number(requirement.max_file_size)) || Number(requirement.max_file_size) < 1 || Number(requirement.max_file_size) > 2147483647)) fail("Requirement file size must be a positive integer.");
    }
    for (const group of groups || []) { object(group, "Requirement group"); text(group.label, "Group label", 255, true); }
}

function validateJobFields(body, creating = true) {
    const result = {};
    for (const [field, label, max] of [["title", "Job title", 255], ["description", "Job description", 60000], ["location", "Job location", 255]]) {
        if (creating || body[field] !== undefined) result[field] = text(body[field], label, max, true);
    }
    if (body.course_target !== undefined) result.course_target = text(body.course_target, "Qualification", 255);
    validateRequirements(body.requirements, body.groups);
    if (body.posting_details !== undefined) {
        result.posting_details = normalizePostingDetails(body.posting_details);
        result.expected_salary = salaryLabel(result.posting_details);
    } else if (creating || body.expected_salary !== undefined) {
        result.expected_salary = text(body.expected_salary, "Expected salary", 255, true);
    }
    return result;
}

module.exports = { JobPostingError, normalizePostingDetails, salaryLabel, validateRequirements, validateJobFields };
