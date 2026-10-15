export const MEMBERSHIP_SECTIONS = [
    { key: "personal_details", numeral: "I", title: "Personal Details" },
    { key: "educational_attainment", numeral: "II", title: "Educational Attainment" },
    { key: "work_experience", numeral: "III", title: "Work Experience", emptyFlag: "no_work_experience" },
    { key: "training_seminars", numeral: "IV", title: "Training / Workshop / Seminar", emptyFlag: "no_training_seminars" },
    { key: "community_involvement", numeral: "V", title: "Community Involvement", emptyFlag: "no_community_involvement" },
    { key: "awards_citations", numeral: "VI", title: "Awards / Citation Received", emptyFlag: "no_awards_citations" }
];

export const MEMBERSHIP_PERSONAL_FIELDS = [
    { key: "last_name", label: "Last Name", required: true },
    { key: "first_name", label: "First Name", required: true },
    { key: "middle_name", label: "Middle Name" },
    { key: "extension", label: "Extension (Jr., Sr., I, II, etc.)" },
    { key: "date_of_birth", label: "Date of Birth", type: "date" },
    { key: "civil_status", label: "Civil Status", choices: ["Single", "Married", "Widowed", "Separated", "Other"] },
    { key: "sex", label: "Sex", choices: ["Female", "Male", "Prefer not to say"] },
    { key: "place_of_birth", label: "Place of Birth" },
    { key: "current_address", label: "Current Address", multiline: true },
    { key: "permanent_address", label: "Permanent Address", multiline: true },
    { key: "height", label: "Height (cm)" },
    { key: "weight", label: "Weight (kg)" },
    { key: "blood_type", label: "Blood Type", choices: ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "Unknown"] },
    { key: "citizenship", label: "Citizenship" },
    { key: "tin", label: "Tax Identification Number (optional)", sensitive: true },
    { key: "religion", label: "Religion (Denomination, optional)", sensitive: true },
    { key: "occupation", label: "Occupation" },
    { key: "designation", label: "Designation / Position" },
    { key: "agency_office", label: "Agency / Office Affiliated" },
    { key: "office_address", label: "Office Address", multiline: true },
    { key: "social_media_account", label: "Social Media Account" },
    { key: "contact_number", label: "Contact Number", type: "tel", required: true },
    { key: "email", label: "Email Address", type: "email", required: true },
    { key: "other_contact", label: "Other Ways to Be Contacted" }
];

export const MEMBERSHIP_ROW_FIELDS = {
    educational_attainment: [
        { key: "level", label: "Education Level" },
        { key: "school_name", label: "School / Institution" },
        { key: "address", label: "School Address" },
        { key: "year_graduated", label: "Year Graduated", inputMode: "numeric" },
        { key: "honors_awards", label: "Honor / Awards" }
    ],
    work_experience: [
        { key: "employment_period", label: "Date / Employment Period" },
        { key: "position", label: "Position" },
        { key: "agency_employer", label: "Agency / Employer" },
        { key: "employment_status", label: "Employment Status", choices: ["Full-time", "Part-time", "Contractual", "Self-employed", "Other"] }
    ],
    training_seminars: [
        { key: "title", label: "Title of Training / Workshop" },
        { key: "date", label: "Date", type: "date" },
        { key: "venue", label: "Venue" },
        { key: "facilitator", label: "Conducted / Facilitated By" }
    ],
    community_involvement: [
        { key: "date", label: "Date", type: "date" },
        { key: "organization", label: "Organization / Association / Cooperative" },
        { key: "designation", label: "Designation / Position" },
        { key: "years", label: "Years" }
    ],
    awards_citations: [
        { key: "award", label: "Award / Citation Received" },
        { key: "date", label: "Date", type: "date" },
        { key: "venue", label: "Place / Venue" },
        { key: "awarding_body", label: "Award Giving Body" }
    ]
};

const object = value => {
    if (typeof value === "string") { try { value = JSON.parse(value); } catch { return {}; } }
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
};
const array = value => {
    if (typeof value === "string") { try { value = JSON.parse(value); } catch { return []; } }
    return Array.isArray(value) ? value : [];
};
const text = value => typeof value === "string" || typeof value === "number" ? String(value) : "";
export const membershipDate = value => /^\d{4}-\d{2}-\d{2}/.test(text(value)) ? text(value).slice(0, 10) : "";
const fieldsObject = (source, fields) => Object.fromEntries(fields.map(field => [field.key,
    field.type === "date" ? membershipDate(source?.[field.key]) : text(source?.[field.key])
]));

export function normalizeMembershipApplication(source = {}) {
    const record = object(source);
    const personal = object(record.personal_details);
    const options = object(record.options);
    const result = {
        personal_details: fieldsObject(personal, MEMBERSHIP_PERSONAL_FIELDS),
        options: Object.fromEntries(MEMBERSHIP_SECTIONS.filter(section => section.emptyFlag)
            .map(section => [section.emptyFlag, options[section.emptyFlag] === true])),
        consent_accepted: record.consent_accepted === true || record.consent_accepted === 1,
        application_status: text(record.application_status),
        submitted_at: record.submitted_at || null,
        consent_accepted_at: record.consent_accepted_at || null,
        consent_text: text(record.consent_text),
        consent_version: text(record.consent_version),
        ...(record.id != null ? { id: record.id } : {})
    };
    for (const [key, fields] of Object.entries(MEMBERSHIP_ROW_FIELDS)) {
        result[key] = array(record[key]).filter(row => row && typeof row === "object" && !Array.isArray(row))
            .map(row => ({ ...fieldsObject(row, fields), ...(key === "educational_attainment" ? {
                program: text(row.program), competency: text(row.competency)
            } : {}) }));
    }
    return result;
}

export const MEMBERSHIP_EDUCATION_LEVELS = ["Elementary", "High School", "Technical / Vocational", "Bachelor's Degree", "Masteral Degree", "Doctorate Degree"];

// Keep old, populated fields visible even when their level is nonstandard.
export function membershipEducationFieldApplies(row, key) {
    if (text(row?.[key]).trim()) return true;
    if (key === "program") return /bachelor|master|doctor/i.test(row?.level || "");
    if (key === "competency") return /technical|vocational/i.test(row?.level || "");
    return true;
}

export function membershipEducationReviewValue(row, key) {
    return text(row?.[key]).trim() || (membershipEducationFieldApplies(row, key) ? "Not provided" : "N/A");
}
export function createMembershipDraft(prefill = {}) {
    return ensureEducationLevels(normalizeMembershipApplication({ ...object(prefill), application_status: "draft", consent_accepted: false }));
}

export function ensureEducationLevels(draft) {
    const normalized = normalizeMembershipApplication(draft);
    const normalizedLevel = level => {
        const normalized = level.toLowerCase().replace(/[’']/g, "").replace(/\s+/g, " ").trim();
        if (/^bachelors?( degree)?$/.test(normalized)) return "bachelor";
        if (/^(masters?|masteral)( degree)?$/.test(normalized)) return "master";
        if (/^doctorate( degree)?$/.test(normalized)) return "doctorate";
        return normalized.replace(/\s*\/\s*/g, "/");
    };
    const matches = (row, level) => normalizedLevel(row.level) === normalizedLevel(level);
    const used = new Set();
    const educational_attainment = MEMBERSHIP_EDUCATION_LEVELS.map(level => {
        const index = normalized.educational_attainment.findIndex((row, i) => !used.has(i) && matches(row, level));
        if (index >= 0) used.add(index);
        return { ...fieldsObject({}, MEMBERSHIP_ROW_FIELDS.educational_attainment), ...(index >= 0 ? normalized.educational_attainment[index] : {}), level };
    });
    return { ...normalized, educational_attainment: [...educational_attainment, ...normalized.educational_attainment.filter((_, index) => !used.has(index))] };
}

export function membershipPayload(draft, accepted = false) {
    const normalized = normalizeMembershipApplication(draft);
    const payload = {
        personal_details: Object.fromEntries(Object.entries(normalized.personal_details).map(([key, value]) => [key, value.trim()])),
        options: normalized.options,
        consent_accepted: accepted === true
    };
    for (const section of MEMBERSHIP_SECTIONS.slice(1)) {
        payload[section.key] = section.emptyFlag && normalized.options[section.emptyFlag] ? [] : normalized[section.key]
            .map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value.trim()])))
            .filter(row => Object.entries(row).some(([key, value]) => key !== "level" && Boolean(value)));
    }
    return payload;
}

export function validateMembershipApplication(draft, accepted = false) {
    const personal = membershipPayload(draft).personal_details;
    const errors = {};
    for (const field of MEMBERSHIP_PERSONAL_FIELDS.filter(field => field.required)) {
        if (!personal[field.key]) errors[field.key] = `${field.label} is required.`;
    }
    if (personal.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(personal.email)) errors.email = "Enter a valid email address.";
    if (!accepted) errors.consent_accepted = "Please read and accept the consent acknowledgement before submitting.";
    return errors;
}

export const membershipFingerprint = draft => JSON.stringify(membershipPayload(draft));
export const membershipFullName = draft => {
    const personal = normalizeMembershipApplication(draft).personal_details;
    return [personal.first_name, personal.middle_name, personal.last_name, personal.extension].filter(Boolean).join(" ");
};

export function ageFromBirthDate(value, today = new Date()) {
    const date = membershipDate(value);
    if (!date) return "";
    const [year, month, day] = date.split("-").map(Number);
    const birth = new Date(year, month - 1, day);
    if (birth.getFullYear() !== year || birth.getMonth() !== month - 1 || birth.getDate() !== day || birth > today) return "";
    let age = today.getFullYear() - year;
    if (today.getMonth() < month - 1 || (today.getMonth() === month - 1 && today.getDate() < day)) age -= 1;
    return age;
}

export function unwrapMembershipResponse(response) {
    if (!response || typeof response !== "object" || !Object.hasOwn(response, "application")) {
        throw new Error("The membership service returned an invalid response. Please try again.");
    }
    if (response.application != null && (typeof response.application !== "object" || Array.isArray(response.application))) {
        throw new Error("The membership application could not be loaded. Please try again.");
    }
    return { ...response, application: response.application ? normalizeMembershipApplication(response.application) : null };
}
