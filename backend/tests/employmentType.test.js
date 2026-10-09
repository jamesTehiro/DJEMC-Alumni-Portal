const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeEmploymentType } = require("../utils/employmentType");

test("normalizes all supported employment types to canonical values", () => {
    const values = [
        "Full-Time",
        "Part-Time",
        "Contractual",
        "Temporary",
        "Permanent",
        "Freelance",
        "Project-Based"
    ];
    const expected = [
        "full-time",
        "part-time",
        "contractual",
        "temporary",
        "permanent",
        "freelance",
        "project-based"
    ];

    assert.deepEqual(values.map(normalizeEmploymentType), expected);
});

test("accepts legacy contract values and formatting variants", () => {
    assert.equal(normalizeEmploymentType("contract"), "contractual");
    assert.equal(normalizeEmploymentType(" CONTRACTUAL "), "contractual");
    assert.equal(normalizeEmploymentType("Project Based"), "project-based");
});

test("rejects unsupported employment types", () => {
    assert.equal(normalizeEmploymentType("internship"), null);
});
