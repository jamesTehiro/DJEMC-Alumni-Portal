"use strict";

const CONSENT_VERSION = "djemc-membership-2026-01";
const CONSENT_TEXT = "I hereby certify that the above-mentioned information/data is true and correct. I acknowledge that the provided information will be kept confidential and used solely for the stated purpose. My personal data will not be shared with third parties without my explicit consent, except as required by law.";
const PERSONAL_FIELDS = ["last_name", "first_name", "middle_name", "extension", "date_of_birth", "civil_status", "sex", "place_of_birth", "current_address", "permanent_address", "height", "weight", "blood_type", "citizenship", "tin", "religion", "occupation", "designation", "agency_office", "office_address", "social_media_account", "contact_number", "email", "other_contact"];
const ROW_FIELDS = {
    educational_attainment: ["level", "school_name", "address", "year_graduated", "honors_awards", "program", "competency"],
    work_experience: ["employment_period", "position", "agency_employer", "employment_status"],
    training_seminars: ["title", "date", "venue", "facilitator"],
    community_involvement: ["date", "organization", "designation", "years"],
    awards_citations: ["award", "date", "venue", "awarding_body"]
};
const OPTION_FIELDS = ["no_work_experience", "no_training_seminars", "no_community_involvement", "no_awards_citations"];
const invalid = (message, field) => Object.assign(new Error(message), { status: 400, field });
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);

function cleanObject(value, fields, section) {
    if (!isObject(value)) throw invalid(`The ${section.replaceAll("_", " ")} section must contain fields.`, section);
    const clean = {};
    for (const field of fields) {
        const input = value[field];
        if (input === undefined || input === null) { clean[field] = ""; continue; }
        if (typeof input !== "string" && typeof input !== "number") throw invalid(`Invalid ${field.replaceAll("_", " ")}.`, `${section}.${field}`);
        const text = String(input).trim();
        if (text.length > 2000) throw invalid(`${field.replaceAll("_", " ")} must be 2,000 characters or fewer.`, `${section}.${field}`);
        if (section === "personal_details" && ["last_name", "first_name", "middle_name", "extension"].includes(field) && text.length > 120) throw invalid("Name fields must be 120 characters or fewer.", `${section}.${field}`);
        clean[field] = text;
    }
    return clean;
}

function normalizeMembership(body, submit = false) {
    if (!isObject(body)) throw invalid("The membership application must contain an object.");
    if (Buffer.byteLength(JSON.stringify(body), "utf8") > 512 * 1024) throw Object.assign(new Error("The membership application is too large."), { status: 413 });
    const clean = { personal_details: cleanObject(body.personal_details || {}, PERSONAL_FIELDS, "personal_details") };
    for (const [section, fields] of Object.entries(ROW_FIELDS)) {
        const rows = body[section] ?? [];
        if (!Array.isArray(rows) || rows.length > 100) throw invalid(`${section.replaceAll("_", " ")} must contain no more than 100 entries.`, section);
        clean[section] = rows.map(row => cleanObject(row, fields, section)).filter(row => Object.values(row).some(Boolean));
    }
    const options = body.options ?? {};
    if (!isObject(options)) throw invalid("Invalid application options.", "options");
    clean.options = {};
    for (const field of OPTION_FIELDS) {
        if (options[field] !== undefined && typeof options[field] !== "boolean") throw invalid("Application options must be true or false.", field);
        clean.options[field] = options[field] === true;
        const section = field.replace(/^no_/, "");
        if (clean.options[field] && clean[section].length) throw invalid(`Remove the ${section.replaceAll("_", " ")} entries before selecting none.`, section);
    }
    const birthDate = clean.personal_details.date_of_birth;
    if (birthDate && !/^n\/?a$/i.test(birthDate)) {
        const parsed = new Date(`${birthDate}T00:00:00Z`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== birthDate || parsed > new Date()) {
            throw invalid("Enter a valid date of birth that is not in the future.", "personal_details.date_of_birth");
        }
    }
    if (submit) {
        for (const field of ["first_name", "last_name", "email", "contact_number"]) {
            if (!clean.personal_details[field]) throw invalid(`${field.replaceAll("_", " ")} is required.`, `personal_details.${field}`);
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean.personal_details.email)) throw invalid("Enter a valid email address.", "personal_details.email");
        if (body.consent_accepted !== true) throw invalid("Accept the declaration before submitting your application.", "consent_accepted");
    }
    return clean;
}

module.exports = { CONSENT_VERSION, CONSENT_TEXT, PERSONAL_FIELDS, ROW_FIELDS, OPTION_FIELDS, normalizeMembership };
