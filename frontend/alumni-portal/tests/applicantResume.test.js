import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildSync } from "esbuild";
import {
    createApplicantResumePreviewLoader,
    getApplicantDocumentFilename,
    getApplicantResumeDocument,
    getApplicantResumeFileUrl,
    getApplicantResumePreviewType,
    isResumeRequirement,
} from "../src/utils/applicantResume.js";

const deferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
};

function loaderHarness(fetchDocument) {
    const states = [];
    const created = [];
    const revoked = [];
    const loader = createApplicantResumePreviewLoader({
        fetchDocument,
        onChange: (value) => states.push(value),
        createObjectURL: (blob) => { created.push(blob); return `blob:resume-${created.length}`; },
        revokeObjectURL: (url) => revoked.push(url),
    });
    return { loader, states, created, revoked };
}

test("resume selection uses requirement codes and snapshot labels, never the filename", () => {
    assert.equal(isResumeRequirement({ requirement_code: "resume", label: "Resume / CV" }), true);
    assert.equal(isResumeRequirement({ requirement_code: "custom_abc", label: "Updated Resume/CV" }), true);
    assert.equal(isResumeRequirement({ requirement_code: "custom_abc", label: "Curriculum Vitae" }), true);
    assert.equal(isResumeRequirement({ requirement_code: "custom_abc", label: "Résumé" }), true);
    assert.equal(isResumeRequirement({ requirement_code: "cover_letter", label: "Resume cover letter" }, { file_name: "James_Resume.pdf" }), false);
    assert.equal(isResumeRequirement({ requirement_code: "custom_abc", label: "Cover letter for résumé" }), false);
    assert.equal(isResumeRequirement({ requirement_code: "tor", label: "Transcript of Records" }, { file_name: "resume.pdf" }), false);
    assert.equal(isResumeRequirement({}, { file_name: "resume.pdf" }), false);
});

test("grouped custom resume selects its actual stored original filename", () => {
    const resume = { id: 8, requirement_code: "custom_cv", file_name: "James Tehiro Resume.pdf" };
    const application = {
        JobRequirementSnapshot: { snapshot_data: { groups: [{ requirements: [{ requirement_code: "custom_cv", label: "Updated Resume/CV" }] }] } },
        ApplicationDocuments: [{ id: 7, requirement_code: "cover_letter", file_name: "cover.pdf" }, resume],
    };
    assert.equal(getApplicantResumeDocument(application), resume);
    assert.equal(getApplicantDocumentFilename(resume), "James Tehiro Resume.pdf");
    assert.equal(getApplicantDocumentFilename({ original_filename: "Original Name.PDF", file_name: "stored-key.pdf" }), "Original Name.PDF");
});

test("ungrouped requirements and older applications preserve secure resume selection", () => {
    const document = { id: 5, requirement_code: "resume", file_name: "resume.png" };
    assert.equal(getApplicantResumeDocument({ ApplicationDocuments: [document] }), document);
    const legacy = getApplicantResumeDocument({ resume_path: "C:\\private\\uploads\\resumes\\old.pdf", resume_file_name: "Original legacy name.pdf", resume_mime_type: "application/pdf" });
    assert.equal(legacy.isLegacyResume, true);
    assert.equal(legacy.file_name, "Original legacy name.pdf");
    assert.equal(getApplicantResumeFileUrl(42, legacy), "/api/applications/42/resume/file");
    assert.equal(getApplicantResumeDocument({}), null);
    assert.equal(getApplicantResumeDocument({ resume_path: "C:\\private\\resumes\\old.pdf" }).file_name, "old.pdf");
    assert.equal(getApplicantResumeDocument({
        resume_path: "/uploads/resumes/compatibility-file.pdf",
        JobRequirementSnapshot: { snapshot_data: { ungrouped: [{ requirement_code: "tor", label: "Transcript of Records" }] } },
        ApplicationDocuments: [{ id: 10, requirement_code: "tor", file_name: "resume.pdf" }],
    }), null);
});

test("file URLs always use application-scoped authenticated endpoints", () => {
    assert.equal(getApplicantResumeFileUrl(4, { id: 9, file_path: "https://untrusted.example/resume.pdf" }), "/api/applications/4/documents/9/file");
    assert.equal(getApplicantResumeFileUrl("4/5", { id: "9/10" }), "/api/applications/4%2F5/documents/9%2F10/file");
    assert.equal(getApplicantResumeFileUrl(4, { file_path: "/uploads/resumes/private.pdf" }), "");
    assert.equal(getApplicantResumeFileUrl(null, { id: 9 }), "");
});

test("initial null applications and malformed older attachment payloads do not crash", () => {
    for (const application of [null, undefined, "", {}, { ApplicationDocuments: {} }, { ApplicationDocuments: [null] }, { JobRequirementSnapshot: { snapshot_data: { groups: {}, ungrouped: {} } } }, { JobRequirementSnapshot: { snapshot_data: "invalid JSON" } }]) {
        assert.equal(getApplicantResumeDocument(application), null);
    }
    const document = { id: 8, requirement_code: "custom_cv", file_name: "Resume.pdf" };
    assert.equal(getApplicantResumeDocument({
        JobRequirementSnapshot: { snapshot_data: JSON.stringify({ ungrouped: [{ requirement_code: "custom_cv", label: "Resume / CV" }] }) },
        ApplicationDocuments: [document],
    }), document);
    assert.equal(getApplicantDocumentFilename(null), "Uploaded document");
    assert.equal(isResumeRequirement(null, null), false);
});

test("PDF and allowed images render inline; Word documents and other formats use fallback", () => {
    assert.equal(getApplicantResumePreviewType({ file_name: "Resume.PDF" }), "pdf");
    assert.equal(getApplicantResumePreviewType({ file_name: "resume" }, { type: "application/pdf; charset=binary" }), "pdf");
    for (const ext of ["jpg", "jpeg", "png"]) assert.equal(getApplicantResumePreviewType({ file_name: `Resume.${ext}` }), "image");
    for (const ext of ["doc", "docx"]) assert.equal(getApplicantResumePreviewType({ file_name: `Resume.${ext}` }), "file");
    assert.equal(getApplicantResumePreviewType({ mime_type: "application/msword" }), "file");
    assert.equal(getApplicantResumePreviewType({ file_name: "Resume.svg", mime_type: "image/svg+xml" }), "file");
});

test("preview requests authenticate, type generic PDFs correctly, and revoke URLs on close", async () => {
    const calls = [];
    const harness = loaderHarness(async (...args) => { calls.push(args); return new Blob(["%PDF-test"], { type: "application/octet-stream" }); });
    await harness.loader.load(4, { id: 9, file_name: "Resume.pdf" });
    assert.deepEqual(calls, [["/api/applications/4/documents/9/file", true]]);
    assert.equal(harness.states[0].status, "loading");
    assert.equal(harness.states.at(-1).type, "pdf");
    assert.equal(harness.states.at(-1).url, "blob:resume-1");
    assert.equal(harness.created[0].type, "application/pdf");
    harness.loader.dispose();
    harness.loader.dispose();
    assert.deepEqual(harness.revoked, ["blob:resume-1"]);
});

test("switching documents revokes the previous URL and ignores stale request responses", async () => {
    const first = deferred();
    const second = deferred();
    const harness = loaderHarness((path) => path.includes("/1/file") ? first.promise : second.promise);
    const request1 = harness.loader.load(4, { id: 1, file_name: "First.pdf" });
    const request2 = harness.loader.load(4, { id: 2, file_name: "Second.png" });
    second.resolve(new Blob(["image"], { type: "image/png" }));
    await request2;
    first.resolve(new Blob(["pdf"], { type: "application/pdf" }));
    await request1;
    assert.equal(harness.created.length, 1);
    assert.equal(harness.states.at(-1).type, "image");
    await harness.loader.load(4, { id: 2, file_name: "Second.png" });
    assert.deepEqual(harness.revoked, ["blob:resume-1"]);
    harness.loader.dispose();
    assert.deepEqual(harness.revoked, ["blob:resume-1", "blob:resume-2"]);
});

test("closing during a request prevents URLs and state changes from late responses", async () => {
    const response = deferred();
    const harness = loaderHarness(() => response.promise);
    const pending = harness.loader.load(4, { id: 1, file_name: "Resume.pdf" });
    harness.loader.dispose();
    response.resolve(new Blob(["pdf"], { type: "application/pdf" }));
    await pending;
    assert.equal(harness.created.length, 0);
    assert.deepEqual(harness.states, [{ status: "loading" }]);
});

test("unavailable, empty, and incorrect server responses show errors without creating object URLs", async () => {
    for (const blob of [new Blob([]), new Blob(["<html>error</html>"], { type: "text/html" }), new Blob(["{}"], { type: "application/json" }), new Blob(["{}"], { type: "application/problem+json" }), new Blob(["<svg/>"], { type: "image/svg+xml" })]) {
        const harness = loaderHarness(async () => blob);
        await harness.loader.load(4, { id: 1, file_name: "Resume.pdf" });
        assert.equal(harness.states.at(-1).status, "error");
        assert.equal(harness.created.length, 0);
    }
    const denied = loaderHarness(async () => { throw new Error("You are not allowed to access this document."); });
    await denied.loader.load(4, { id: 1 });
    assert.match(denied.states.at(-1).message, /not allowed/);
});

test("DOCX fallback authenticates but never creates an embedded document URL", async () => {
    const harness = loaderHarness(async () => new Blob(["word"], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }));
    await harness.loader.load(4, { id: 1, file_name: "Resume.docx" });
    assert.equal(harness.states.at(-1).status, "unsupported");
    assert.equal(harness.created.length, 0);
});

test("missing file records fail safely before requesting a private filesystem path", async () => {
    let called = false;
    const harness = loaderHarness(async () => { called = true; });
    await harness.loader.load(4, { file_name: "Resume.pdf", file_path: "C:\\private\\resume.pdf" });
    assert.equal(called, false);
    assert.equal(harness.states.at(-1).status, "error");
});

const require = createRequire(import.meta.url);
const compiled = buildSync({
    entryPoints: [fileURLToPath(new URL("../src/components/ApplicantResumePreview.jsx", import.meta.url))],
    bundle: true, write: false, format: "cjs", platform: "node", packages: "external",
    define: { "import.meta.env": "{}" }, loader: { ".css": "empty" }, logLevel: "silent",
});
const compiledModule = { exports: {} };
new Function("require", "module", "exports", compiled.outputFiles[0].text)(require, compiledModule, compiledModule.exports);
const ApplicantResumePreview = compiledModule.exports.default;

test("shared preview renders actual long filenames, loading, close, View, and Download controls", () => {
    const filename = `${"Long resume filename ".repeat(12)}<James>.pdf`;
    const html = renderToStaticMarkup(React.createElement(ApplicantResumePreview, {
        applicationId: 4, document: { id: 1, file_name: filename }, onClose() {}, onView() {}, onDownload() {},
    }));
    for (const value of ["Resume Preview", "Loading resume", "Close preview", ">View<", ">Download<", "&lt;James&gt;.pdf"]) assert.ok(html.includes(value), value);
    assert.equal(renderToStaticMarkup(React.createElement(ApplicantResumePreview, { document: null })), "");
    assert.doesNotMatch(html, /<iframe|<img/);
});
