export const EMPLOYMENT_TYPE_OPTIONS = [
    { value: "full-time", label: "Full-Time" },
    { value: "part-time", label: "Part-Time" },
    { value: "contractual", label: "Contractual" },
    { value: "temporary", label: "Temporary" },
    { value: "permanent", label: "Permanent" },
    { value: "freelance", label: "Freelance" },
    { value: "project-based", label: "Project-Based" }
];

const employmentTypeLabels = new Map(
    EMPLOYMENT_TYPE_OPTIONS.map(({ value, label }) => [value, label])
);

export const normalizeEmploymentType = (value) => {
    const normalized = String(value ?? "")
        .trim()
        .toLowerCase()
        .replace(/[\s_]+/g, "-");

    if (!normalized) return "";
    if (normalized === "contract") return "contractual";
    return normalized;
};

export const getEmploymentTypeLabel = (value, fallback = "Open") => {
    const normalized = normalizeEmploymentType(value);
    if (!normalized) return fallback;
    return employmentTypeLabels.get(normalized) || String(value).trim();
};
