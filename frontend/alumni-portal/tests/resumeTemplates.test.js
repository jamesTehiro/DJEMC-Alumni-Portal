import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildSync } from "esbuild";
import { createResumeSections, formatResumeDate, getResumeDocumentStyle } from "../src/components/resume/templates/resumeTemplateData.js";
import { RESUME_TEMPLATE_OPTIONS, normalizeTemplateId } from "../src/components/resume/templates/resumeTemplateConfig.js";

const require = createRequire(import.meta.url);
const templatePath = fileURLToPath(new URL("../src/components/resume/templates/ResumePreviewTemplate.jsx", import.meta.url));
const compiled = buildSync({ entryPoints: [templatePath], bundle: true, platform: "node", format: "cjs", packages: "external", write: false }).outputFiles[0].text;
const compiledModule = { exports: {} };
new Function("require", "module", "exports", compiled)(require, compiledModule, compiledModule.exports);
const ResumePreviewTemplate = compiledModule.exports.default;

const allSectionsResume = {
    id: 41,
    personalInfo: { full_name: "Alex Dela Cruz", email: "alex@example.com", phone: "09123456789", linkedin: "linkedin.com/in/alex", website: "example.com", photo_url: "data:image/png;base64,iVBORw0KGgo=" },
    summary: { content: "Professional summary." },
    workExperience: [{ job_title: "Coordinator", company: "Community Office", start_date: "2024-01-01", is_current: true, description: "Employment description." }],
    education: [{ institution: "DJEMC", degree: "BS", field_of_study: "Management", gpa: "1.5", is_current: true }],
    skills: [{ skill_name: "Communication", category: "Professional" }],
    projects: [{ project_name: "Community Directory", technologies: "React", url: "example.com/project", description: "Project description." }],
    certifications: [{ name: "Certificate", issuer: "Learning Center", issue_date: "2025-03-01", expiry_date: "2027-03-01", credential_id: "ABC123", url: "example.com/certificate" }],
    trainings: [{ training_name: "Office Training", provider: "Training Center", completion_date: "2025-05-01", description: "Training description." }],
    seminars: [{ seminar_name: "Career Seminar", organizer: "Career Office", date: "2025-08-01", location: "Manila", description: "Seminar description." }],
    awards: [{ title: "Service Award", issuer: "DJEMC", date: "2025-06-01", description: "Award description." }],
    languages: [{ language: "Filipino", proficiency: "Native" }],
    organizations: [{ organization_name: "Graduate Association", position: "Secretary", is_current: true, description: "Organization description." }],
    volunteerWork: [{ organization: "Community Pantry", role: "Volunteer", description: "Volunteer description." }],
    references: [{ name: "Maria Santos", relationship: "Supervisor", company: "Community Office", email: "maria@example.com", phone: "09121112222" }]
};

test("all resume sections render in the supported order with their complete details", () => {
    const sections = createResumeSections(allSectionsResume);
    assert.deepEqual(sections.map(section => section.id), ["summary", "workExperience", "education", "skills", "projects", "certifications", "trainings", "seminars", "awards", "languages", "organizations", "volunteerWork", "references"]);
    const html = renderToStaticMarkup(React.createElement(ResumePreviewTemplate, { resume: allSectionsResume }));
    for (const detail of ["Professional summary.", "Employment description.", "GPA: 1.5", "Technologies: React", "Credential: ABC123", "Expires Mar 2027", "Office Training", "Seminar description.", "Award description.", "Organization description.", "Volunteer description.", "maria@example.com", "09121112222", "linkedin.com/in/alex"]) assert.ok(html.includes(detail), `Missing detail: ${detail}`);
    assert.ok(html.includes("djemc-resume-photo"));
    assert.ok(html.includes('data-resume-id="41"'));
    assert.equal(sections[1].items[0].meta, "Jan 2024 – Present");
});

test("legacy form aliases preserve their data in the canonical renderer", () => {
    const sections = createResumeSections({
        education: [{ school: "Legacy School", current: true }], projects: [{ name: "Legacy Project" }], trainings: [{ title: "Legacy Training", start_date: "2024-01-01", end_date: "2024-02-01" }],
        seminars: [{ title: "Legacy Seminar" }], languages: [{ name: "English" }], organizations: [{ name: "Legacy Organization", role: "Chair" }], references: [{ name: "Legacy Reference", position: "Mentor" }]
    });
    assert.equal(sections[0].items[0].subtitle, "Legacy School");
    assert.equal(sections[0].items[0].meta, "Present");
    assert.equal(sections[1].items[0].title, "Legacy Project");
    assert.equal(sections[2].items[0].meta, "Jan 2024 – Feb 2024");
    assert.equal(sections[3].items[0].title, "Legacy Seminar");
    assert.equal(sections[4].items[0].title, "English");
    assert.equal(sections[5].items[0].subtitle, "Chair");
    assert.equal(sections[6].items[0].subtitle, "Mentor");
});

test("empty optional sections and empty added entries are omitted", () => {
    assert.deepEqual(createResumeSections({ summary: { content: "   " }, education: [{ id: 1, resume_id: 3, sort_order: 1, institution: "" }], projects: [null, {}], skills: [{ skill_name: "" }], languages: [] }), []);
    const html = renderToStaticMarkup(React.createElement(ResumePreviewTemplate, { resume: {} }));
    assert.ok(!html.includes("djemc-resume-section-heading"));
    assert.ok(!html.includes("undefined"));
});

test("entries follow saved sort_order without mutating the source array", () => {
    const skills = [{ skill_name: "Third", sort_order: 3 }, { skill_name: "First", sort_order: 1 }, { skill_name: "Second", sort_order: 2 }];
    assert.deepEqual(createResumeSections({ skills })[0].items.map(item => item.title), ["First", "Second", "Third"]);
    assert.equal(skills[0].skill_name, "Third");
});

test("existing IDs and legacy names select the corresponding design", () => {
    for (const template of RESUME_TEMPLATE_OPTIONS) {
        assert.equal(normalizeTemplateId(template.name), template.id);
        assert.equal(normalizeTemplateId(template.id.replace(/-/g, "_")), template.id);
        const html = renderToStaticMarkup(React.createElement(ResumePreviewTemplate, { resume: { ...allSectionsResume, template_id: template.id } }));
        assert.ok(html.includes(`djemc-resume-${template.id}`));
        assert.ok(html.includes(`data-template-id="${template.id}"`));
    }
    assert.equal(normalizeTemplateId("unknown-template"), "university-green");
});

test("long text is retained and text fields are HTML escaped", () => {
    const content = "Long description with details. ".repeat(1200);
    const html = renderToStaticMarkup(React.createElement(ResumePreviewTemplate, { resume: { personalInfo: { full_name: '<script>alert("resume")</script>' }, summary: { content } } }));
    assert.ok(html.includes(content.trim()));
    assert.ok(html.includes("&lt;script&gt;"));
    assert.ok(!html.includes("<script>"));
});

test("document style settings constrain invalid values and retain supported customizations", () => {
    assert.equal(getResumeDocumentStyle({ font_size: 50, line_spacing: 0.2 })["--resume-font-size"], "14pt");
    assert.equal(getResumeDocumentStyle({ line_spacing: 0.2 })["--resume-line-height"], 1.15);
    assert.equal(getResumeDocumentStyle({ color_theme: "#1b8a72" })["--resume-accent"], "#1b8a72");
    assert.ok(!getResumeDocumentStyle({ color_theme: "red; background:url(remote)" })["--resume-accent"]);
    assert.equal(formatResumeDate("2025-08-14T00:00:00.000Z"), "Aug 2025");
    assert.equal(formatResumeDate("2025-13-01"), "2025-13-01");
});

test("each design has its own A4 stylesheet rules and document text can wrap", () => {
    const css = readFileSync(new URL("../src/components/resume/ResumeTemplates.css", import.meta.url), "utf8");
    for (const template of RESUME_TEMPLATE_OPTIONS) assert.ok(css.includes(`.djemc-resume-document.djemc-resume-${template.id}`));
    assert.ok(css.includes("width: 210mm"));
    assert.ok(css.includes("height: 297mm"));
    assert.ok(css.includes("overflow-wrap: anywhere"));
    assert.ok(css.includes("column-count: 2"));
    assert.ok(css.includes("grid-template-columns: 34mm"));
    assert.ok(!/overflow:\s*hidden/.test(css));
});

test("all templates group skills once per category, omit empty headings and preserve unknown legacy skills", () => {
    const skills = [
        { skill_name: "Node.js", category: "Programming", sort_order: 1 },
        { skill_name: "Git", category: "Tools and Technologies", sort_order: 2 },
        { skill_name: "JavaScript", category: " programming ", sort_order: 3 },
        { skill_name: "Problem solving", category: null, sort_order: 4 },
        { skill_name: "", category: "Empty Category" }
    ];
    const sections = createResumeSections({ skills });
    assert.deepEqual(sections[0].items.map(item => item.title), ["Node.js", "JavaScript", "Git", "Problem solving"]);
    assert.deepEqual(sections[0].items.filter(item => item.categoryHeading).map(item => item.categoryHeading), ["Programming", "Tools and Technologies", "Uncategorized"]);
    for (const template of RESUME_TEMPLATE_OPTIONS) {
        const html = renderToStaticMarkup(React.createElement(ResumePreviewTemplate, { resume: { skills, template_id: template.id, settings: { skill_categories: ["Empty Category"] } } }));
        assert.equal((html.match(/class="djemc-resume-skill-category"/g) || []).length, 3);
        assert.equal((html.match(/>Programming<\/h3>/g) || []).length, 1);
        assert.ok(!html.includes("Empty Category"));
        assert.ok(html.includes("Problem solving"));
    }
    const legacy = renderToStaticMarkup(React.createElement(ResumePreviewTemplate, { resume: { skills: [{ skill_name: "Legacy skill" }, { skill_name: "Other", category: "Uncategorized" }] } }));
    assert.ok(legacy.includes("Legacy skill"));
    assert.ok(!legacy.includes("djemc-resume-skill-category"));
});

test("all templates group skills once per category, omit empty headings and preserve unknown legacy skills", () => {
    const skills = [
        { skill_name: "Node.js", category: "Programming", sort_order: 1 },
        { skill_name: "Git", category: "Tools and Technologies", sort_order: 2 },
        { skill_name: "JavaScript", category: " programming ", sort_order: 3 },
        { skill_name: "Problem solving", category: null, sort_order: 4 },
        { skill_name: "", category: "Empty Category" }
    ];
    const sections = createResumeSections({ skills });
    assert.deepEqual(sections[0].items.map(item => item.title), ["Node.js", "JavaScript", "Git", "Problem solving"]);
    assert.deepEqual(sections[0].items.filter(item => item.categoryHeading).map(item => item.categoryHeading), ["Programming", "Tools and Technologies", "Uncategorized"]);
    for (const template of RESUME_TEMPLATE_OPTIONS) {
        const html = renderToStaticMarkup(React.createElement(ResumePreviewTemplate, { resume: { skills, template_id: template.id, settings: { skill_categories: ["Empty Category"] } } }));
        assert.equal((html.match(/class="djemc-resume-skill-category"/g) || []).length, 3);
        assert.equal((html.match(/>Programming<\/h3>/g) || []).length, 1);
        assert.ok(!html.includes("Empty Category"));
        assert.ok(html.includes("Problem solving"));
    }
    const legacy = renderToStaticMarkup(React.createElement(ResumePreviewTemplate, { resume: { skills: [{ skill_name: "Legacy skill" }, { skill_name: "Other", category: "Uncategorized" }] } }));
    assert.ok(legacy.includes("Legacy skill"));
    assert.ok(!legacy.includes("djemc-resume-skill-category"));
});
