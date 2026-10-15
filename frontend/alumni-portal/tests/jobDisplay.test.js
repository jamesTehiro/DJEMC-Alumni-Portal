import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getJobCompanyName, getJobPostingMeta } from "../src/utils/jobDisplay.js";

test("job company comes from its owner profile rather than caller advertisement identity", () => {
    assert.equal(getJobCompanyName({ company_name: "Spoofed", User: { name: "Owner", EmployerProfile: { organization_name: "Registered Company" } } }), "Registered Company");
    assert.equal(getJobCompanyName({ User: { name: "Trusted Admin" } }), "Trusted Admin");
    assert.equal(getJobCompanyName(null), "Employer");
});

test("new posting metadata supports saved JSON and safely omits missing legacy fields", () => {
    const details = { work_setup: "hybrid", vacancy_count: 3, application: { deadline: "2026-12-01" } };
    assert.deepEqual(getJobPostingMeta({ posting_details: details }), { workSetup: "Hybrid", vacancies: 3, deadline: "2026-12-01" });
    assert.deepEqual(getJobPostingMeta({ posting_details: JSON.stringify(details) }), getJobPostingMeta({ posting_details: details }));
    for (const job of [null, {}, { posting_details: "invalid" }, { posting_details: { work_setup: "wrong", vacancy_count: -1 } }]) assert.deepEqual(getJobPostingMeta(job), { workSetup: "", vacancies: null, deadline: "" });
});

test("alumni cards omit View Job while preserving Apply, details, and job filters", () => {
    const source = readFileSync(new URL("../src/pages/JobsPage.jsx", import.meta.url), "utf8");
    assert.match(source, /<JobPostingAdvertisement job=\{selectedJob\} requirements=\{previewRequirements\}/);
    assert.doesNotMatch(source, />\s*View Job\s*</);
    assert.doesNotMatch(source, /className="job-view-btn"/);
    assert.match(source, /onClick=\{\(\) => handleOpenApply\(job\)\}/);
    assert.match(source, /handleOpenJobDetails\(job\);/, "Apply must retain the existing job-details step");
    assert.match(source, /className="apply-btn applied-btn" disabled/);
    assert.match(source, /<JobApplicationModal/);
    assert.match(source, /searchMatch && locationMatch && typeMatch/);
    assert.match(source, /api\.get\(`\/jobs\/\$\{selectedJob\.id\}\/requirements`\)/);
    assert.doesNotMatch(source, /api\.get\(`\/profile\//, "Job previews must not fetch full employer profiles for logos");
});
