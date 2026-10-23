import test from "node:test";
import assert from "node:assert/strict";
import { getSkillCategories, groupResumeSkills, validateSkillCategory, validateResumeSkills } from "../src/utils/resumeSkills.js";
import { normalizeResume, persistResume, resumePayload, validateResume } from "../src/utils/resumeWorkflow.js";

const programming = ["Node.js", "JavaScript", "CSS", "HTML", "React", "Vite", "MySQL"].map(skill_name => ({ category: "Programming", skill_name }));

test("custom categories group all programming skills and preserve legacy Uncategorized entries", () => {
    const skills = [...programming, { category: "Tools and Technologies", skill_name: "Git" }, { skill_name: "Problem solving" }, { category: "Uncategorized", skill_name: "Teamwork" }];
    const original = structuredClone(skills);
    const groups = groupResumeSkills(skills, ["Programming", "Tools and Technologies", "Empty Category"]);
    assert.deepEqual(groups.map(group => group.category), ["Programming", "Tools and Technologies", "Empty Category", "Uncategorized"]);
    assert.deepEqual(groups[0].items.map(item => item.skill_name), programming.map(item => item.skill_name));
    assert.equal(groups[2].items.length, 0);
    assert.equal(groups[3].items.length, 2);
    assert.deepEqual(skills, original);
    assert.deepEqual(getSkillCategories([{ category: " programming " }, { category: "PROGRAMMING" }, { category: null }]), ["programming"]);
    assert.equal(groupResumeSkills([{ category: "__proto__", skill_name: "Safe custom name" }])[0].category, "__proto__");
});

test("empty/oversized names and case-insensitive duplicates fail only within the same category", () => {
    assert.match(validateSkillCategory("   "), /Enter a category/);
    assert.match(validateSkillCategory("x".repeat(101)), /100/);
    assert.match(validateSkillCategory(" programming ", ["Programming"]), /already exists/);
    assert.equal(validateSkillCategory(" programming ", ["Programming"], "Programming"), "");
    assert.match(validateSkillCategory("Uncategorized"), /reserved/);
    assert.equal(validateResumeSkills(programming), "");
    assert.match(validateResumeSkills([...programming, { category: " programming ", skill_name: " react " }]), /already exists/);
    assert.equal(validateResumeSkills([...programming, { category: "Tools", skill_name: "React" }]), "");
    assert.match(validateResumeSkills([{ skill_name: " " }]), /name/);
    assert.match(validateResumeSkills([{ skill_name: "x".repeat(256) }]), /255/);
    assert.match(validateResumeSkills([{ skill_name: "React", category: "x".repeat(101) }]), /100/);
    assert.match(validateResumeSkills([{ skill_name: "React", category: null }, { skill_name: "React", category: "Uncategorized" }]), /already exists/);
    assert.equal(validateResumeSkills([{ skill_name: "Legacy", category: null }, { skill_name: "Other legacy" }]), "");
});

test("save/reload retains categorized skills, empty category settings and unrelated information", async () => {
    const resume = normalizeResume({ id: 41, title: "Skills fixture", personalInfo: { full_name: "Fixture Graduate", email: "fixture@example.invalid" }, summary: { content: "Preserved summary" }, education: [{ institution: "DJEMC" }], settings: { client_draft_id: "skills-fixture", skill_categories: ["Programming", "Empty Category"], existing_setting: true }, skills: programming });
    let saved;
    const api = { put: async (url, body, auth) => { assert.equal(url, "/resumes/41"); assert.equal(auth, true); saved = structuredClone(body); }, get: async () => ({ id: 41, ...saved }) };
    const result = await persistResume({ api, resume });
    assert.deepEqual(result.skills, programming);
    assert.deepEqual(result.settings, resume.settings);
    assert.deepEqual(result.education, resume.education);
    assert.deepEqual(result.summary, resume.summary);
    const moved = normalizeResume({ ...result, skills: result.skills.map(item => item.skill_name === "MySQL" ? { ...item, category: "Database Management" } : item) });
    assert.equal(resumePayload(moved).skills.at(-1).category, "Database Management");
    assert.match(validateResume({ ...moved, skills: [{ skill_name: "" }] }).skills, /name/);
});
