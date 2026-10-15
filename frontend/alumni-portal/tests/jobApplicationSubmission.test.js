import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildSync } from "esbuild";
import {
    APPLICATION_TOAST_DELAY,
    APPLICATION_SUCCESS_TITLE,
    APPLICATION_SUCCESS_MESSAGE,
    validateSubmittedApplication,
    performApplicationSubmission
} from "../src/utils/jobApplicationSubmission.js";

const require = createRequire(import.meta.url);
const compiled = buildSync({
    entryPoints: [fileURLToPath(new URL("../src/components/RegistrationSuccessToast.jsx", import.meta.url))],
    bundle: true,
    write: false,
    format: "cjs",
    platform: "node",
    packages: "external",
    loader: { ".css": "empty" },
    logLevel: "silent"
});
const compiledModule = { exports: {} };
new Function("require", "module", "exports", compiled.outputFiles[0].text)(require, compiledModule, compiledModule.exports);
const { RegistrationToastContent, default: RegistrationSuccessToast } = compiledModule.exports;
const application = { id: 701, job_id: 42, alumni_id: 12, status: "pending" };

function deferred() {
    let resolve, reject;
    const promise = new Promise((fulfill, fail) => { resolve = fulfill; reject = fail; });
    return { promise, resolve, reject };
}

function harness(request) {
    const inFlight = { current: false };
    const busy = [], successes = [], failures = [];
    const submit = () => performApplicationSubmission({
        inFlight,
        jobId: 42,
        request,
        onBusy(value) { busy.push(value); },
        onSuccess(value) { assert.equal(inFlight.current, true); successes.push(value); },
        onFailure(error) { assert.equal(inFlight.current, true); failures.push(error); }
    });
    return { submit, inFlight, busy, successes, failures };
}

test("application notification uses the requested message and a seven-second delay without guaranteeing contact", () => {
    assert.equal(APPLICATION_TOAST_DELAY, 7000);
    assert.equal(APPLICATION_SUCCESS_TITLE, "Application Submitted Successfully!");
    assert.equal(APPLICATION_SUCCESS_MESSAGE, "Your application has been submitted successfully. Please wait for the employer to contact you regarding the next steps. You may be contacted within 24 hours, depending on the employer's recruitment process.");
});

test("success waits for the backend application acknowledgement before updating the UI", async () => {
    const pending = deferred();
    const state = harness(() => pending.promise);
    const result = state.submit();
    assert.equal(state.inFlight.current, true);
    assert.deepEqual(state.busy, [true]);
    assert.deepEqual(state.successes, []);
    assert.deepEqual(state.failures, []);
    pending.resolve(application);
    assert.equal(await result, true);
    assert.deepEqual(state.successes, [application]);
    assert.deepEqual(state.failures, []);
    assert.equal(state.inFlight.current, false);
    assert.deepEqual(state.busy, [true, false]);
});

test("a repeated submission during the same render cannot send a second request", async () => {
    const pending = deferred();
    let calls = 0;
    const state = harness(() => { calls++; return pending.promise; });
    const first = state.submit();
    assert.equal(await state.submit(), false);
    assert.equal(calls, 1);
    assert.deepEqual(state.busy, [true]);
    assert.deepEqual(state.successes, []);
    pending.resolve(application);
    assert.equal(await first, true);
    assert.equal(calls, 1);
    assert.equal(state.successes.length, 1);
});

test("backend rejection displays the actual error, produces no success, and permits a safe retry", async () => {
    const backendError = Object.assign(new Error('Required document "TOR" is missing.'), { status: 400 });
    let calls = 0;
    const state = harness(async () => {
        calls++;
        if (calls === 1) throw backendError;
        return application;
    });
    assert.equal(await state.submit(), false);
    assert.deepEqual(state.successes, []);
    assert.deepEqual(state.failures, [backendError]);
    assert.equal(state.failures[0].status, 400);
    assert.equal(state.inFlight.current, false);
    assert.deepEqual(state.busy, [true, false]);
    assert.equal(await state.submit(), true);
    assert.equal(calls, 2);
    assert.deepEqual(state.successes, [application]);
    assert.deepEqual(state.busy, [true, false, true, false]);
});

test("synchronous request failures release the lock and do not announce success", async () => {
    const failure = new Error("You need to log in first.");
    const state = harness(() => { throw failure; });
    assert.equal(await state.submit(), false);
    assert.deepEqual(state.failures, [failure]);
    assert.deepEqual(state.successes, []);
    assert.equal(state.inFlight.current, false);
    assert.deepEqual(state.busy, [true, false]);
});

test("malformed successful responses cannot mark a job Applied or show a success toast", async () => {
    const responses = [null, undefined, "HTML error page", [], {}, { msg: "OK" }, { data: application }, { ...application, id: 0 }, { ...application, id: -1 }, { ...application, id: 1.5 }, { ...application, id: "invalid" }, { ...application, job_id: null }];
    for (const response of responses) {
        const state = harness(async () => response);
        assert.equal(await state.submit(), false, JSON.stringify(response));
        assert.deepEqual(state.successes, []);
        assert.equal(state.failures.length, 1);
        assert.ok(state.failures[0] instanceof Error);
        assert.equal(state.inFlight.current, false);
        assert.deepEqual(state.busy, [true, false]);
    }
});

test("a different job acknowledgement and explicitly rejected statuses are not application success", async () => {
    for (const response of [{ ...application, job_id: 43 }, ...["rejected", "declined", "cancelled"].map(status => ({ ...application, status }))]) {
        const state = harness(async () => response);
        assert.equal(await state.submit(), false);
        assert.deepEqual(state.successes, []);
        assert.equal(state.failures.length, 1);
        assert.equal(state.inFlight.current, false);
    }
});

test("acknowledgement validation supports numeric IDs and existing statuses without migrating their values", () => {
    for (const status of ["pending", "verified", "approved", "ready_for_interview", undefined]) {
        assert.doesNotThrow(() => validateSubmittedApplication({ ...application, status }, 42));
    }
    assert.doesNotThrow(() => validateSubmittedApplication({ ...application, id: "701", job_id: "42" }, "42"));
    assert.throws(() => validateSubmittedApplication(application, 43));
});

test("success toast renders its icon, exact message, accessible status, and manual close action", () => {
    let closes = 0;
    const props = { title: APPLICATION_SUCCESS_TITLE, message: APPLICATION_SUCCESS_MESSAGE, onClose: () => { closes++; } };
    const html = renderToStaticMarkup(React.createElement(RegistrationToastContent, props));
    assert.match(html, /role="status"/);
    assert.match(html, /aria-live="polite"/);
    assert.match(html, /aria-atomic="true"/);
    assert.match(html, /<svg[^>]+class="registration-toast-icon"/);
    assert.match(html, /aria-hidden="true"/);
    assert.ok(html.includes(APPLICATION_SUCCESS_TITLE));
    assert.ok(html.includes(APPLICATION_SUCCESS_MESSAGE.replaceAll("'", "&#x27;")));
    assert.match(html, /type="button"[^>]+aria-label="Close notification"/);
    const element = RegistrationToastContent(props);
    const closeButton = element.props.children.find(child => child.type === "button");
    closeButton.props.onClick();
    assert.equal(closes, 1);
    assert.doesNotMatch(html, /registration-success-toast--error/);
});

test("error toast uses an alert icon and assertive announcements without changing registration defaults", () => {
    const html = renderToStaticMarkup(React.createElement(RegistrationToastContent, { variant: "error", title: "Application Could Not Be Submitted", message: "The employer stopped recruitment.", onClose() {} }));
    assert.match(html, /registration-success-toast--error/);
    assert.match(html, /role="alert"/);
    assert.match(html, /aria-live="assertive"/);
    assert.ok(html.includes("The employer stopped recruitment."));
    assert.match(html, /<svg/);
    const success = RegistrationToastContent({ title: "Registered", message: "Saved", onClose() {} });
    const error = RegistrationToastContent({ variant: "error", title: "Failed", message: "Error", onClose() {} });
    assert.notEqual(success.props.children[0].type, error.props.children[0].type);
    assert.equal(success.props.className, "registration-success-toast");
});

test("toast remains hidden without show and adds portal positioning only when explicitly requested", () => {
    assert.equal(RegistrationSuccessToast({ show: false }), null);
    if (typeof document === "undefined") assert.equal(RegistrationSuccessToast({ show: true }), null);
    const previousDocument = globalThis.document;
    try {
        globalThis.document = { body: { nodeType: 1 } };
        const defaults = RegistrationSuccessToast({ show: true, title: "Registered", message: "Saved" });
        assert.equal(defaults.children.props.className, "registration-toast-positioner");
        const positioned = RegistrationSuccessToast({ show: true, title: "Submitted", message: "Saved", variant: "error", positionerClassName: "job-application-toast-positioner" });
        assert.equal(positioned.children.props.className, "registration-toast-positioner job-application-toast-positioner");
        assert.equal(positioned.children.props.children.props.variant, "error");
    } finally {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
    }
});

test("application modal preserves the authenticated multipart endpoint and requirement payloads", () => {
    const source = readFileSync(new URL("../src/components/JobApplicationModal.jsx", import.meta.url), "utf8");
    assert.match(source, /const formData = new FormData\(\)/);
    assert.match(source, /formData\.append\("job_id", job\?\.id\)/);
    assert.match(source, /formData\.append\("resume", uploadedResume\)/);
    assert.match(source, /formData\.append\("resume_id", selectedResumeId\)/);
    assert.match(source, /formData\.append\(`requirement_\$\{code\}`, file\)/);
    assert.match(source, /formData\.append\(fieldName, value\)/);
    assert.match(source, /await performApplicationSubmission\(\{/);
    assert.match(source, /inFlight: submissionInFlight/);
    assert.match(source, /request: \(\) => api\.post\("\/applications", formData, true\)/);
    assert.match(source, /onSuccess: \(application\) => \{\s*resetState\(\);\s*onSubmitted\?\.\(application\);\s*onHide\?\.\(\);\s*\}/);
    assert.match(source, /onFailure: reportFailure/);
    assert.doesNotMatch(source, /await api\.post\("\/applications"/);
});

test("application submission locks repeated events and dismissal without losing validation or input state", () => {
    const source = readFileSync(new URL("../src/components/JobApplicationModal.jsx", import.meta.url), "utf8");
    assert.match(source, /const submissionInFlight = useRef\(false\)/);
    assert.match(source, /if \(submissionInFlight\.current\) return;/);
    assert.match(source, /if \(!submissionInFlight\.current\) onHide\?\.\(\)/);
    assert.match(source, /onHide=\{handleHide\}/);
    assert.match(source, /backdrop=\{submitting \? "static" : true\}/);
    assert.match(source, /keyboard=\{!submitting\}/);
    assert.match(source, /closeButton=\{!submitting\}/);
    assert.match(source, /<fieldset disabled=\{submitting\}>/);
    assert.match(source, /aria-busy=\{submitting\}/);
    assert.match(source, /disabled=\{submitting \|\| !isFormComplete \|\| requirements\.length === 0\}/);
    assert.match(source, /submitting \? "Submitting\.\.\." : "Submit Application"/);
    assert.match(source, /reportFailure\(new Error\("Please complete all required information/);
    assert.match(source, /onSubmissionError\?\./);
});

test("JobsPage uses the confirmed job ID, clears toast timers, and wires distinct success and error notifications", () => {
    const source = readFileSync(new URL("../src/pages/JobsPage.jsx", import.meta.url), "utf8");
    assert.match(source, /setAppliedJobIds\(\(prev\) => \[\.\.\.new Set\(\[\.\.\.prev, Number\(application\.job_id\)\]\)\]\)/);
    assert.match(source, /variant: "success", title: APPLICATION_SUCCESS_TITLE, message: APPLICATION_SUCCESS_MESSAGE/);
    assert.match(source, /variant: "error"/);
    assert.match(source, /message: failure\?\.message \|\| "Your application could not be submitted/);
    assert.match(source, /window\.setTimeout\(\(\) => setApplicationNotice\(null\), APPLICATION_TOAST_DELAY\)/);
    assert.match(source, /return \(\) => window\.clearTimeout\(timer\)/);
    assert.match(source, /\}, \[applicationNotice\]\)/);
    assert.match(source, /onSubmitted=\{handleSubmitted\}/);
    assert.match(source, /onSubmissionError=\{handleSubmissionError\}/);
    assert.match(source, /<RegistrationSuccessToast/);
    assert.match(source, /onClose=\{\(\) => setApplicationNotice\(null\)\}/);
    assert.doesNotMatch(source, /setActionMessage\("Application submitted\."\)/);
});

test("job-only toast positioning and sole card action keep mobile navigation clear", () => {
    const source = readFileSync(new URL("../src/pages/JobPage.css", import.meta.url), "utf8");
    const desktop = source.match(/\.jobs-application-toast\.registration-toast-positioner\s*\{([^}]+)\}/)?.[1];
    assert.ok(desktop, "Toast positioning must be scoped to the jobs page");
    assert.match(desktop, /--portal-header-height/);
    assert.match(desktop, /right:\s*20px/);
    const soleAction = source.match(/\.jobs-page \.job-card-actions \.apply-btn\s*\{([^}]+)\}/)?.[1];
    assert.ok(soleAction, "The remaining card action must have a scoped width rule");
    assert.match(soleAction, /flex:\s*1 1 100%/);
    assert.match(soleAction, /width:\s*100%/);
    const mobile = source.match(/@media\s*\(max-width:\s*640px\)\s*\{\s*\.jobs-application-toast\.registration-toast-positioner\s*\{([^}]+)\}/)?.[1];
    assert.ok(mobile, "Mobile toast positioning must remain scoped");
    assert.match(mobile, /--portal-header-height/);
    assert.match(mobile, /left:\s*12px/);
    assert.match(mobile, /right:\s*12px/);
    assert.match(mobile, /width:\s*auto/);
});
