import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildSync } from "esbuild";
import { createJobPostingForm, jobCompanyName, jobPostingPayload, postingDetailsOf, salaryDisplay, validateJobPosting } from "../src/utils/jobPosting.js";

const require = createRequire(import.meta.url);
function component(name) {
    const bundle = buildSync({ entryPoints: [fileURLToPath(new URL(`../src/components/jobs/${name}.jsx`, import.meta.url))], bundle: true, write: false, format: "cjs", platform: "node", external: ["react"], loader: { ".css": "empty" }, logLevel: "silent" });
    const module = { exports: {} };
    new Function("require", "module", "exports", bundle.outputFiles[0].text)(require, module, module.exports);
    return module.exports.default;
}
const Advertisement = component("JobPostingAdvertisement");
const PostingForm = component("JobPostingForm");
const requirements = [{ requirement_code: "custom_cv", label: "Resume / CV", requirement_type: "document_upload", value_type: "file", required: true, is_custom: true, allowed_types: "pdf,docx", max_file_size: 5 }];
const complete = () => {
    const form = createJobPostingForm();
    Object.assign(form, { title: "HR Assistant", description: "Help our people team.", location: "San Jose", course_target: "BSBA", interview_details: { venue: "Office", place: "Dinagat", date: "2027-01-03", time: "09:00", contact_info: "hr@example.invalid", what_to_bring: "CV" } });
    form.posting_details.compensation.min = "15000";
    form.posting_details.compensation.max = "20000";
    return form;
};
const render = job => renderToStaticMarkup(React.createElement(Advertisement, { job, requirements }));

test("fresh forms have independent nested state and no advertised benefits or contact opt-in", () => {
    const a = createJobPostingForm(), b = createJobPostingForm();
    a.posting_details.responsibilities.push("One task");
    assert.deepEqual(b.posting_details.responsibilities, []);
    assert.deepEqual(b.posting_details.benefits, { government: [], additional: [], other: [] });
    assert.equal(b.posting_details.application.publish_contact, false);
    assert.equal(b.posting_details.application.method, "portal");
});
test("valid complete job uses the existing interview and custom requirement workflow", () => {
    assert.deepEqual(validateJobPosting(complete(), requirements), []);
    const payload = jobPostingPayload(complete(), requirements);
    assert.equal(payload.interview_details.venue, "Office");
    assert.equal(payload.requirements[0].allowed_types, "pdf,docx");
    assert.equal(payload.requirements[0].max_file_size, 5);
    assert.equal(payload.requirements[0].required, true);
    assert.equal(payload.course_target, "BSBA");
    assert.match(payload.expected_salary, /15,000.*20,000.*month/);
});
test("required job fields and requirements are validated", () => {
    const errors = validateJobPosting(createJobPostingForm(), []);
    for (const field of ["Job Title", "Job Location", "Job Description", "application requirement"]) assert.ok(errors.some(error => error.includes(field)), field);
    const form = complete(); form.title = "   ";
    assert.ok(validateJobPosting(form, requirements).includes("Job Title is required."));
});
test("salary validation rejects negatives, invalid numbers, inverted ranges and missing amounts", () => {
    for (const [min, max] of [[-1, 100], ["invalid", 100], [200, 100], ["", ""], [Infinity, 200], ["1.234", 200]]) {
        const form = complete(); Object.assign(form.posting_details.compensation, { min, max });
        assert.ok(validateJobPosting(form, requirements).some(error => /Salary|salary/.test(error)), `${min}/${max}`);
    }
    for (const display of ["negotiable", "based-on-experience"]) {
        const form = complete(); Object.assign(form.posting_details.compensation, { min: "", max: "", display });
        assert.deepEqual(validateJobPosting(form, requirements), []);
        assert.ok(jobPostingPayload(form, requirements).expected_salary);
    }
});
test("vacancies are optional or positive bounded integers and work setup uses real enums", () => {
    const form = complete();
    assert.equal(jobPostingPayload(form, requirements).posting_details.vacancy_count, null);
    for (const value of ["0", "1.5", "100001", "bad"]) {
        form.posting_details.vacancy_count = value;
        assert.ok(validateJobPosting(form, requirements).some(error => error.includes("Vacancies")));
    }
    form.posting_details.vacancy_count = "2"; form.posting_details.work_setup = "hybrid";
    const payload = jobPostingPayload(form, requirements);
    assert.equal(payload.posting_details.vacancy_count, 2); assert.equal(payload.posting_details.work_setup, "hybrid");
});
test("dynamic posting lists remove only empty entries and stay distinct from required documents", () => {
    const form = complete(); form.posting_details.responsibilities = [" Payroll ", "", "Recruitment"];
    form.posting_details.required_qualifications.skills = [" Communication ", ""];
    form.posting_details.preferred_qualifications = ["HR certificate"];
    form.posting_details.benefits.other = ["Lunch allowance"];
    const payload = jobPostingPayload(form, requirements);
    assert.deepEqual(payload.posting_details.responsibilities, ["Payroll", "Recruitment"]);
    assert.deepEqual(payload.posting_details.required_qualifications.skills, ["Communication"]);
    assert.deepEqual(payload.posting_details.preferred_qualifications, ["HR certificate"]);
    assert.deepEqual(payload.posting_details.benefits.other, ["Lunch allowance"]);
    assert.equal(payload.requirements[0].label, "Resume / CV");
});
test("requirement labels and unique codes validate and information types cannot remain file", () => {
    assert.ok(validateJobPosting(complete(), [{ ...requirements[0], label: " " }]).some(error => error.includes("needs a label")));
    assert.ok(validateJobPosting(complete(), [requirements[0], requirements[0]]).some(error => error.includes("unique")));
    const payload = jobPostingPayload(complete(), [{ ...requirements[0], requirement_type: "information_field", value_type: "file" }]);
    assert.equal(payload.requirements[0].value_type, "text");
});
test("dates and selected contact email are validated", () => {
    const form = complete(); form.posting_details.application.deadline = "2027-02-30";
    assert.ok(validateJobPosting(form, requirements).some(error => error.includes("valid date")));
    form.posting_details.application.deadline = "2027-02-28";
    form.posting_details.application.publish_contact = true;
    form.posting_details.application.contact_email = "invalid-email";
    assert.ok(validateJobPosting(form, requirements).some(error => error.includes("Contact Email")));
});
test("both employer and administrator company names come from account identity", () => {
    assert.equal(jobCompanyName({ User: { EmployerProfile: { organization_name: "Authenticated Company" }, name: "Owner" }, company_name: "Fake company" }), "Authenticated Company");
    assert.equal(jobCompanyName({ User: { admin_organization: "DJEMC", name: "Admin" } }), "DJEMC");
    assert.equal(jobCompanyName(null, { EmployerProfile: { organization_name: "Employer Org" } }), "Employer Org");
});
test("salary formatting handles all periods, open amounts and old salary text", () => {
    assert.match(salaryDisplay({ min: 100, max: null, period: "daily", display: "range" }), /From.*100.*day/);
    assert.match(salaryDisplay({ min: null, max: 200, period: "hourly", display: "range" }), /Up to.*200.*hour/);
    assert.equal(salaryDisplay(null, "Negotiable"), "Negotiable");
    assert.equal(salaryDisplay({ display: "based-on-experience" }), "Based on Experience");
});
test("posting details tolerate legacy null, JSON strings and malformed data", () => {
    assert.equal(postingDetailsOf({}), null); assert.equal(postingDetailsOf({ posting_details: "bad" }), null);
    assert.equal(postingDetailsOf({ posting_details: "[]" }), null);
    assert.equal(postingDetailsOf({ posting_details: '{"work_setup":"remote"}' }).work_setup, "remote");
});
test("rendered advertisement contains actual structured fields and explicit benefits", () => {
    const form = complete(); Object.assign(form.posting_details, { work_setup: "remote", vacancy_count: "3", industry: "Education", company_description: "Our school", responsibilities: ["Support faculty"], preferred_qualifications: ["HR experience"] });
    form.posting_details.required_qualifications.education = "Bachelor’s Degree";
    form.posting_details.benefits.government = ["SSS"];
    form.posting_details.application.deadline = "2027-02-28";
    const html = render({ ...jobPostingPayload(form, requirements), User: { admin_organization: "DJEMC" } });
    for (const value of ["WE ARE HIRING!", "HR Assistant", "DJEMC", "Remote", "Vacancies", "Our school", "Support faculty", "Bachelor’s Degree", "HR experience", "SSS", "February 28, 2027", "Resume / CV", "DJEMC Alumni Tracking and Job Portal"]) assert.ok(html.includes(value), value);
    assert.ok(!html.includes("PhilHealth")); assert.ok(!html.includes("Interview Date"));
});
test("rendered contact fields require explicit publication opt-in", () => {
    const form = complete(); Object.assign(form.posting_details.application, { contact_email: "private@example.invalid", contact_number: "09123456789", walk_in_address: "Private address", office_hours: "9–5" });
    let html = render(jobPostingPayload(form, requirements));
    for (const value of ["private@example.invalid", "09123456789", "Private address", "9–5"]) assert.ok(!html.includes(value));
    form.posting_details.application.publish_contact = true;
    html = render(jobPostingPayload(form, requirements));
    for (const value of ["private@example.invalid", "09123456789", "Private address", "9–5"]) assert.ok(html.includes(value));
});
test("legacy postings render existing content without inventing optional sections or benefits", () => {
    const html = render({ title: "Legacy Job", description: "Old description", location: "Dinagat", employment_type: "full-time", course_target: "BSIT", expected_salary: "Negotiable" });
    for (const value of ["Legacy Job", "Old description", "Dinagat", "BSIT", "Negotiable"]) assert.ok(html.includes(value));
    for (const value of ["About the Company", "Key Responsibilities", "Preferred Qualifications", "PhilHealth", "Vacancies"]) assert.ok(!html.includes(value));
});
test("advertisement escapes text and tolerates missing or malformed optional fields", () => {
    const html = render({ title: '<script>alert("job")</script>', description: "<img src=x onerror=alert(1)>", posting_details: { responsibilities: {}, required_qualifications: {}, benefits: { government: null }, application: {} } });
    assert.ok(html.includes("&lt;script&gt;")); assert.ok(!html.includes("<script>")); assert.ok(!html.includes("<img"));
});
test("shared form renders all sections with dynamic list actions and privacy defaults", () => {
    const html = renderToStaticMarkup(React.createElement(PostingForm, { value: createJobPostingForm(), onChange() {}, profile: { admin_organization: "DJEMC" }, requirements: [], requirementsEditor: React.createElement("button", { type: "button" }, "+ Custom Requirement"), onConfigureInterview() {}, onPublish() {} }));
    for (const value of ["Basic Job Information", "About the Company", "About the Role", "Qualifications", "Salary &amp; Benefits", "How to Apply", "Application Requirements", "Preview Job Posting", "+ Custom Requirement", "Add Responsibility", "Add Skill", "Add Qualification", "Add Benefit"]) assert.ok(html.includes(value), value);
    assert.ok(!html.includes('type="checkbox" checked')); assert.ok(!html.includes("Publish Job</button>"));
    assert.ok(!html.includes("Contact Email (optional)")); assert.match(html, /readonly=""/i);
});
test("industry inherits the current company profile when no job override is entered", () => {
    const form = complete();
    assert.equal(jobPostingPayload(form, requirements).posting_details.industry, "");
    let html = render({ ...jobPostingPayload(form, requirements), User: { EmployerProfile: { organization_name: "Current company", industry: "Information Technology" } } });
    assert.ok(html.includes("Information Technology"));
    form.posting_details.industry = "Education";
    html = render({ ...jobPostingPayload(form, requirements), User: { EmployerProfile: { industry: "Information Technology" } } });
    assert.ok(html.includes("Education")); assert.ok(!html.includes("Information Technology"));
});
test("both role parents reuse the same form, payload and synchronous publication lock", () => {
    for (const path of ["../src/pages/EmployerPage.jsx", "../src/pages/admin/AdminModerationPage.jsx"]) {
        const source = readFileSync(new URL(path, import.meta.url), "utf8");
        assert.match(source, /<JobPostingForm/); assert.match(source, /jobPostingPayload\(form, requirements\)/);
        assert.match(source, /if \(jobSubmitInFlight.current\) return false/);
        assert.match(source, /jobSubmitInFlight.current = true/);
        assert.match(source, /jobSubmitInFlight.current = false/);
        assert.match(source, /<InterviewDetailsModal/);
    }
    const form = readFileSync(new URL("../src/components/jobs/JobPostingForm.jsx", import.meta.url), "utf8");
    assert.match(form, /if \(!preview\) \{ setPreview\(true\); return; \}/);
    assert.match(form, /await onPublish\(\)/);
});

test("posting does not require interview configuration", () => {
    const form = complete();
    form.interview_details = null;
    assert.deepEqual(validateJobPosting(form, requirements), []);
});

test("posting form omits interview configuration and preserves preview and application fields", () => {
    const html = renderToStaticMarkup(React.createElement(PostingForm, { value: complete(), onChange() {}, requirements }));
    assert.doesNotMatch(html, /Configure Interview Details|Interview Invitation|interview details are required/i);
    assert.match(html, /Preview Job Posting/);
    assert.match(html, /Application Deadline/);
    assert.match(html, /Application Instructions/);
});
