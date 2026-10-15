import test from "node:test";
import assert from "node:assert/strict";
import { ageFromBirthDate, createMembershipDraft, ensureEducationLevels, MEMBERSHIP_EDUCATION_LEVELS,
    membershipFingerprint, membershipFullName, membershipPayload, normalizeMembershipApplication,
    unwrapMembershipResponse, validateMembershipApplication } from "../src/utils/membershipApplication.js";

const valid = () => createMembershipDraft({ personal_details: {
    first_name: "Alex", middle_name: "M.", last_name: "Graduate", email: "alex@example.com", contact_number: "09123456789"
} });

test("a new membership draft prepopulates known profile fields without selecting consent", () => {
    const draft = createMembershipDraft({ personal_details: { first_name: "Alex", email: "alex@example.com" },
        educational_attainment: [{ level: "Bachelor’s Degree", school_name: "DJEMC", program: "BSIT", year_graduated: 2026 }] });
    assert.equal(draft.personal_details.first_name, "Alex");
    assert.equal(draft.consent_accepted, false);
    assert.equal(draft.application_status, "draft");
    assert.equal(draft.educational_attainment.length, 6);
    assert.equal(draft.educational_attainment[3].program, "BSIT");
    assert.equal(draft.educational_attainment[3].year_graduated, "2026");
});

test("fixed education levels preserve other stored entries and legacy Master degree labels", () => {
    const draft = ensureEducationLevels({ educational_attainment: [
        { level: "Master's Degree", program: "MBA" }, { level: "Other Degree", school_name: "Other school" }
    ] });
    assert.deepEqual(draft.educational_attainment.slice(0, 6).map(row => row.level), MEMBERSHIP_EDUCATION_LEVELS);
    assert.equal(draft.educational_attainment[4].program, "MBA");
    assert.equal(draft.educational_attainment[6].school_name, "Other school");
});

test("actual backend Bachelor prefill belongs in the fixed row without duplicate or blank academic values", () => {
    const draft = createMembershipDraft({ educational_attainment: [
        { level: "Bachelor's", school_name: "Don Jose Ecleo Memorial College", program: "BSIT", year_graduated: "2026" }
    ] });
    assert.equal(draft.educational_attainment.length, 6);
    assert.equal(draft.educational_attainment[3].school_name, "Don Jose Ecleo Memorial College");
    assert.equal(draft.educational_attainment[3].program, "BSIT");
    assert.equal(draft.educational_attainment[3].year_graduated, "2026");
    assert.equal(draft.educational_attainment[3].level, "Bachelor's Degree");
});

test("normalization supports nullable and JSON database fields safely", () => {
    const draft = normalizeMembershipApplication({ personal_details: '{"first_name":"Alex","date_of_birth":"2000-07-04T00:00:00Z"}',
        work_experience: '[{"agency_employer":"Acme","position":"Developer"}]', training_seminars: null,
        community_involvement: "invalid", awards_citations: [{}], options: '{"no_awards_citations":true}' });
    assert.equal(draft.personal_details.date_of_birth, "2000-07-04");
    assert.equal(draft.work_experience[0].agency_employer, "Acme");
    assert.deepEqual(draft.training_seminars, []);
    assert.deepEqual(draft.community_involvement, []);
    assert.equal(draft.options.no_awards_citations, true);
});

test("submission requires known name/contact fields and explicit consent while sensitive fields remain optional", () => {
    assert.deepEqual(validateMembershipApplication(valid(), true), {});
    assert.ok(validateMembershipApplication(valid(), false).consent_accepted);
    const draft = valid(); draft.personal_details.email = "not-an-email"; draft.personal_details.last_name = " ";
    const errors = validateMembershipApplication(draft, true);
    assert.ok(errors.email); assert.ok(errors.last_name);
    assert.equal(errors.tin, undefined); assert.equal(errors.religion, undefined); assert.equal(errors.date_of_birth, undefined);
});

test("payload includes all six sections, repeatable data, and explicit empty-section flags", () => {
    const draft = valid();
    draft.work_experience = [{ agency_employer: " Acme ", employment_period: "2023–2026", position: "Developer", employment_status: "Full-time" }];
    draft.training_seminars = [{ title: "Workshop", date: "2026-01-02", venue: "DJEMC", facilitator: "Alumni Office" }];
    draft.community_involvement = [{ organization: "Association", designation: "Chair", years: "2", date: "2025-01-01" }];
    draft.awards_citations = [{ award: "Award", date: "2024-01-01", venue: "Hall", awarding_body: "Committee" }];
    const payload = membershipPayload(draft, true);
    assert.equal(payload.work_experience[0].agency_employer, "Acme");
    assert.equal(payload.community_involvement[0].designation, "Chair");
    assert.equal(payload.consent_accepted, true);
    assert.deepEqual(payload.educational_attainment, []);
    draft.options.no_work_experience = true;
    assert.deepEqual(membershipPayload(draft).work_experience, []);
    assert.equal(membershipPayload(draft).options.no_work_experience, true);
    assert.equal(draft.work_experience.length, 1, "toggling the option preserves unsaved inputs until saving");
});

test("payload rejects client ownership, computed age and status metadata", () => {
    const draft = valid(); draft.alumni_user_id = 500; draft.id = 33; draft.personal_details.age = 99;
    draft.personal_details.social_media_account = "alumni-account";
    const payload = membershipPayload(draft);
    assert.equal(payload.id, undefined); assert.equal(payload.alumni_user_id, undefined);
    assert.equal(payload.application_status, undefined); assert.equal(payload.personal_details.age, undefined);
    assert.equal(payload.personal_details.social_media_account, "alumni-account");
    assert.equal(payload.consent_accepted, false);
});

test("derived age respects birthdays, leap days and invalid or future dates", () => {
    assert.equal(ageFromBirthDate("2000-10-14", new Date(2026, 9, 13)), 25);
    assert.equal(ageFromBirthDate("2000-10-14", new Date(2026, 9, 14)), 26);
    assert.equal(ageFromBirthDate("2000-02-29", new Date(2026, 1, 28)), 25);
    assert.equal(ageFromBirthDate("2001-02-29", new Date(2026, 9, 14)), "");
    assert.equal(ageFromBirthDate("2027-01-01", new Date(2026, 9, 14)), "");
    assert.equal(ageFromBirthDate("N/A"), "");
});

test("fingerprint notices edits and ignores missing blank education rows", () => {
    const draft = valid(); const initial = membershipFingerprint(draft);
    draft.personal_details.first_name = "Jordan";
    assert.notEqual(membershipFingerprint(draft), initial);
    assert.equal(membershipFingerprint(createMembershipDraft({})), membershipFingerprint(normalizeMembershipApplication({})));
    assert.equal(membershipFullName(valid()), "Alex M. Graduate");
});

test("response guards reject malformed or missing records instead of showing success", () => {
    assert.throws(() => unwrapMembershipResponse(undefined), /invalid response/);
    assert.throws(() => unwrapMembershipResponse({}), /invalid response/);
    assert.throws(() => unwrapMembershipResponse({ application: [] }), /could not be loaded/);
    assert.equal(unwrapMembershipResponse({ application: null, completion: { submitted: false } }).application, null);
    assert.equal(unwrapMembershipResponse({ application: { id: 2, application_status: "submitted" } }).application.id, 2);
});
