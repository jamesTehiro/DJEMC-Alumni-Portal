import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildSync } from "esbuild";
import {
    ensureEducationLevels,
    membershipPayload,
    normalizeMembershipApplication,
    validateMembershipApplication,
} from "../src/utils/membershipApplication.js";

const require = createRequire(import.meta.url);
const compiled = buildSync({
    entryPoints: [fileURLToPath(new URL("../src/components/membership/MembershipReview.jsx", import.meta.url))],
    bundle: true,
    write: false,
    format: "cjs",
    platform: "node",
    packages: "external",
    loader: { ".css": "empty" },
    logLevel: "silent",
});
const compiledModule = { exports: {} };
new Function("require", "module", "exports", compiled.outputFiles[0].text)(require, compiledModule, compiledModule.exports);
const MembershipReview = compiledModule.exports.default;

const formBundle = buildSync({
    entryPoints: [fileURLToPath(new URL("../src/pages/MembershipApplicationPage.jsx", import.meta.url))],
    bundle: true, write: false, format: "cjs", platform: "node", packages: "external",
    define: { "import.meta.env": "{}" }, loader: { ".css": "empty" }, logLevel: "silent",
});
const formModule = { exports: {} };
new Function("require", "module", "exports", formBundle.outputFiles[0].text)(require, formModule, formModule.exports);
const MembershipEducationTable = formModule.exports.MembershipEducationTable;

const submittedEducation = [
    { level: "Elementary", school_name: "San Jose Elementary", address: "San Jose", year_graduated: "2010", honors_awards: "With Honors" },
    { level: "High School", school_name: "Dinagat National High School", address: "Dinagat", year_graduated: "2014", honors_awards: "N/A" },
    { level: "Technical / Vocational", school_name: "TESDA Center", address: "Surigao", year_graduated: "2016", competency: "Welding NC II", honors_awards: "N/A" },
    { level: "Bachelor's Degree", school_name: "DJEMC", address: "San Jose", year_graduated: "2020", program: "BSIT", honors_awards: "Cum Laude" },
    { level: "Masteral Degree", school_name: "N/A", address: "N/A", year_graduated: "N/A", program: "N/A", honors_awards: "N/A" },
    { level: "Doctorate Degree", school_name: "N/A", address: "N/A", year_graduated: "N/A", program: "N/A", honors_awards: "N/A" },
];


test("legacy course and competency survive draft roundtrips without appearing in review", () => {
 const reopened = ensureEducationLevels(normalizeMembershipApplication(JSON.stringify(membershipPayload(ensureEducationLevels({ educational_attainment: submittedEducation })))));
 const html = renderToStaticMarkup(React.createElement(MembershipReview, { application: reopened }));
 for (const value of ["San Jose Elementary", "Dinagat National High School", "TESDA Center", "DJEMC", "Cum Laude", "2016"]) assert.ok(html.includes(value), value);
 for (const value of ["Welding NC II", "BSIT", "Academic Program / Course", "Technical / Vocational Competency"]) assert.ok(!html.includes(value), value);
 assert.equal(reopened.educational_attainment[2].competency, "Welding NC II");
 assert.equal(reopened.educational_attainment[3].program, "BSIT");
});
test("education editor keeps schools and levels with only address, year and awards data columns", () => {
 const rows = ensureEducationLevels({ educational_attainment: submittedEducation }).educational_attainment;
 const html = renderToStaticMarkup(React.createElement(MembershipEducationTable, { rows, onChange() {} }));
 assert.equal((html.match(/scope="col"/g) || []).length, 4);
 for (const label of ["Education Level / School", "School Address", "Year Graduated", "Honor / Awards"]) assert.ok(html.includes(label));
 for (const value of ["Academic Program / Course", "Technical / Vocational Competency", "Specify Program / Course", "Specify Competency", "-program", "-competency"]) assert.ok(!html.includes(value), value);
 for (let i = 0; i < 6; i++) for (const key of ["school_name", "address", "year_graduated", "honors_awards"]) assert.ok(html.includes('id="membership-education-' + i + '-' + key + '"'));
});
test("Registrar school and graduation year stay read-only, while address and awards stay editable", () => {
 const rows = ensureEducationLevels({ educational_attainment: submittedEducation }).educational_attainment;
 const html = renderToStaticMarkup(React.createElement(MembershipEducationTable, { rows, academicVerified: true, onChange() {} }));
 const input = key => html.match(new RegExp('<input[^>]*id="membership-education-3-' + key + '"[^>]*>'))?.[0] || '';
 for (const key of ["school_name", "year_graduated"]) assert.match(input(key), /readOnly=""/);
 for (const key of ["address", "honors_awards"]) { assert.ok(input(key)); assert.doesNotMatch(input(key), /readOnly=/); }
});
test("remaining education fields can be edited, saved, reopened and submitted without removed fields", () => {
 const { normalizeMembership } = require("../../../backend/services/membershipValidation.js");
 const draft = ensureEducationLevels({ personal_details: { first_name: 'Alex', last_name: 'Cruz', email: 'alex@example.com', contact_number: '123' }, educational_attainment: submittedEducation.map(({ program, competency, ...row }) => row) });
 draft.educational_attainment[2].address = 'Updated school address';
 const saved = normalizeMembership(membershipPayload(draft, true), true);
 const reopened = ensureEducationLevels({ ...saved, educational_attainment: JSON.stringify(saved.educational_attainment) });
 assert.equal(reopened.educational_attainment[2].address, 'Updated school address');
 assert.deepEqual(validateMembershipApplication(reopened, true), {});
 const html = renderToStaticMarkup(React.createElement(MembershipReview, { application: reopened }));
 assert.ok(html.includes('Updated school address'));
 assert.ok(!html.includes('Competency'));
});
test("hidden legacy education values remain saved when another field changes", () => {
 const { normalizeMembership } = require("../../../backend/services/membershipValidation.js");
 const draft = ensureEducationLevels({ educational_attainment: submittedEducation });
 draft.educational_attainment[3].honors_awards = 'Updated honors';
 const saved = normalizeMembership(membershipPayload(draft));
 assert.equal(saved.educational_attainment[3].program, 'BSIT');
 assert.equal(saved.educational_attainment[2].competency, 'Welding NC II');
 assert.equal(saved.educational_attainment[3].honors_awards, 'Updated honors');
});
