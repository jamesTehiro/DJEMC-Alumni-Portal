import { normalizeEmploymentType } from "../../../utils/employmentTypes.js";
import { createJobPostingForm, jobPostingPayload, postingDetailsOf } from "./jobPosting.js";

// Work on a detached draft, including legacy jobs without structured details.
export function jobPostingFormFromJob(job) {
    const defaults = createJobPostingForm();
    const details = postingDetailsOf(job) || {};
    const posting = { ...defaults.posting_details, ...details };
    for (const key of ["required_qualifications", "application", "compensation", "benefits"]) {
        posting[key] = { ...defaults.posting_details[key], ...details[key] };
    }
    for (const key of ["responsibilities", "preferred_qualifications"]) {
        if (!Array.isArray(posting[key])) posting[key] = [];
    }
    for (const key of ["skills", "other"]) {
        if (!Array.isArray(posting.required_qualifications[key])) posting.required_qualifications[key] = [];
    }
    return structuredClone({
        ...defaults,
        ...Object.fromEntries(["title", "description", "location", "course_target", "expected_salary"].map(key => [key, job[key] ?? ""])),
        employment_type: normalizeEmploymentType(job.employment_type) || defaults.employment_type,
        posting_details: posting
    });
}

export function requirementsFromJob(job) {
    return structuredClone(job.requirements || job.JobRequirements || []).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
}

const requirementPayload = (items, groups) => items.map((item, index) => ({
    requirement_code: item.requirement_code,
    label: String(item.label || "").trim(),
    description: item.description || null,
    requirement_type: item.requirement_type,
    value_type: item.requirement_type === "document_upload" ? "file" : item.value_type === "file" ? "text" : item.value_type || "text",
    value_options: item.value_options ?? null,
    required: item.required !== false,
    is_custom: Boolean(item.is_custom),
    library_code: item.library_code,
    library_id: item.library_id || null,
    allowed_types: item.allowed_types ?? null,
    max_file_size: item.max_file_size ?? null,
    condition_enabled: Boolean(item.condition_enabled),
    condition_field: item.condition_field || null,
    condition_operator: item.condition_operator || null,
    condition_value: item.condition_value || null,
    sort_order: index,
    group_temp_id: groups.some(group => String(group.id) === String(item.group_id)) ? `group_${item.group_id}` : null
}));

export function jobPostingUpdatePayload(form, requirements, originalJob) {
    const payload = jobPostingPayload(form, requirements);
    // These fields have separate workflows or are no longer exposed by the form.
    delete payload.interview_details;
    delete payload.expected_salary;
    delete payload.posting_details.compensation;
    delete payload.posting_details.benefits;
    const groups = originalJob.requirement_groups || originalJob.RequirementGroups || [];
    payload.requirements = requirementPayload(requirements, groups);
    if (JSON.stringify(payload.requirements) === JSON.stringify(requirementPayload(requirementsFromJob(originalJob), groups))) {
        // A text-only edit need not create another requirement version.
        delete payload.requirements;
    } else {
        payload.groups = groups.map(group => ({ tempId: `group_${group.id}`, label: group.group_label, sort_order: group.sort_order }));
    }
    return payload;
}
