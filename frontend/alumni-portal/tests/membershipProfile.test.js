import test from "node:test";
import assert from "node:assert/strict";
import { fillEmptyProfileFields, membershipProfileChanges, membershipProfileValues } from "../src/utils/membershipProfile.js";

const membership = () => ({
    personal_details: {
        first_name: "Alex", middle_name: "M.", last_name: "Graduate", extension: "Jr.",
        email: "membership@example.com", contact_number: "09123456789", current_address: "Membership address",
        designation: "Developer", occupation: "Engineer", tin: "private-tax-value", religion: "Private", date_of_birth: "2000-01-01",
        permanent_address: "Private permanent address", citizenship: "Private citizenship", social_media_account: "private-social"
    },
    educational_attainment: [{ level: "Bachelor's Degree", program: "New Program", year_graduated: 2026 }],
    work_experience: [{ agency_employer: "Other Company", position: "Manager" }]
});

const profile = () => ({
    name: "Existing Profile Name", email: "registered@example.com", phone: "Existing phone", address: "Existing address", job_title: "Newer job title",
    course: "Verified Program", graduation_year: "2024", avatar_url: "/uploads/current-photo.jpg", profile_visibility: "private",
    employment_status: "Employed", employment_history: [{ company_name: "Current Company", position: "Current Role", start_year: "2024", end_year: "Present" }]
});

test("membership profile prefill contains only compatible whitelisted fields", () => {
    assert.deepEqual(membershipProfileValues(membership()), {
        name: "Alex M. Graduate Jr.", phone: "09123456789", address: "Membership address", job_title: "Developer"
    });
    assert.deepEqual(Object.keys(membershipProfileValues(membership())).sort(), ["address", "job_title", "name", "phone"]);
});

test("automatic membership prefill fills only empty fields", () => {
    const original = { ...profile(), name: "", phone: "  ", address: null, job_title: undefined };
    const filled = fillEmptyProfileFields(original, membership());
    assert.equal(filled.name, "Alex M. Graduate Jr.");
    assert.equal(filled.phone, "09123456789");
    assert.equal(filled.address, "Membership address");
    assert.equal(filled.job_title, "Developer");
    assert.equal(original.name, "", "original form must not be mutated");
    assert.equal(original.phone, "  ");
});

test("existing and newer profile values stay intact during automatic prefill", () => {
    const original = profile();
    assert.deepEqual(fillEmptyProfileFields(original, membership()), original);
});

test("prefill preserves official academics, registered email, photo, visibility and employment history", () => {
    const original = { ...profile(), name: "", phone: "" };
    const filled = fillEmptyProfileFields(original, membership());
    for (const key of ["email", "course", "graduation_year", "avatar_url", "profile_visibility", "employment_status", "employment_history"]) {
        assert.deepEqual(filled[key], original[key], `${key} must remain unchanged`);
    }
    for (const key of ["tin", "religion", "date_of_birth", "permanent_address", "citizenship", "social_media_account"]) {
        assert.equal(filled[key], undefined, `${key} must not enter the profile form`);
    }
});

test("explicit replacement offers only allowed differences for review", () => {
    const original = profile();
    const changes = membershipProfileChanges(original, membership());
    assert.deepEqual(changes.map(change => change.key).sort(), ["address", "job_title", "name", "phone"]);
    const applied = { ...original, ...Object.fromEntries(changes.map(({ key, value }) => [key, value])) };
    assert.equal(applied.name, "Alex M. Graduate Jr.");
    assert.equal(applied.phone, "09123456789");
    assert.equal(applied.address, "Membership address");
    assert.equal(applied.job_title, "Developer");
    for (const key of ["email", "course", "graduation_year", "avatar_url", "profile_visibility", "employment_status", "employment_history"]) {
        assert.deepEqual(applied[key], original[key]);
    }
});

test("matching membership values produce no unnecessary replacements", () => {
    const matching = { ...profile(), ...membershipProfileValues(membership()) };
    assert.deepEqual(membershipProfileChanges(matching, membership()), []);
});

test("missing optional data neither clears saved fields nor fabricates employment", () => {
    assert.deepEqual(fillEmptyProfileFields(profile(), null), profile());
    assert.deepEqual(membershipProfileChanges(profile(), {}), []);
    assert.deepEqual(membershipProfileValues({ personal_details: { first_name: "Alex", last_name: "Graduate" } }), {
        name: "Alex Graduate", phone: "", address: "", job_title: ""
    });
});

test("occupation is a compatible job title fallback when no designation was supplied", () => {
    const application = membership(); application.personal_details.designation = "";
    assert.equal(membershipProfileValues(application).job_title, "Engineer");
});
