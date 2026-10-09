const allowedEmploymentTypes = new Set([
    "full-time",
    "part-time",
    "contractual",
    "temporary",
    "permanent",
    "freelance",
    "project-based"
]);

const normalizeEmploymentType = (value) => {
    const normalized = String(value ?? "")
        .trim()
        .toLowerCase()
        .replace(/[\s_]+/g, "-");

    if (!normalized) return "";
    const canonical = normalized === "contract" ? "contractual" : normalized;
    return allowedEmploymentTypes.has(canonical) ? canonical : null;
};

module.exports = { normalizeEmploymentType };
