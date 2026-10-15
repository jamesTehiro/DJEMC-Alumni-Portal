import test from "node:test";
import assert from "node:assert/strict";
import { membershipSubmittedDate, requireMembershipPdf } from "../src/utils/membershipDocument.js";

test("submission dates use Manila time consistently with the server date filter", () => {
    assert.equal(membershipSubmittedDate("2026-10-13T16:10:00Z"), "Oct 14, 2026");
});

test("membership download accepts an actual PDF response", async () => {
    const pdf = new Blob(["%PDF-1.7\nSynthetic test"], { type: "application/pdf" });
    assert.equal(await requireMembershipPdf(pdf), pdf);
});

test("membership download rejects HTML error pages, invalid PDF bytes and missing blobs", async () => {
    for (const blob of [new Blob(["<html>Not found</html>"], { type: "text/html" }),
        new Blob(["<html>Error</html>"], { type: "application/pdf" }), undefined]) {
        await assert.rejects(requireMembershipPdf(blob), /PDF/);
    }
});

test("membership download displays JSON authorization and generation errors without saving them", async () => {
    for (const message of ["You are not allowed to view this application.", "PDF generation is busy. Please try again.", "Application not found."]) {
        const response = new Blob([JSON.stringify({ msg: message })], { type: "application/json" });
        await assert.rejects(requireMembershipPdf(response), error => error.message === message);
    }
    const invalidJson = new Blob(["invalid"], { type: "application/json" });
    await assert.rejects(requireMembershipPdf(invalidJson), /Unable to download/);
});

test("membership list dates handle missing or invalid values safely", () => {
    assert.equal(membershipSubmittedDate(null), "Not recorded");
    assert.equal(membershipSubmittedDate("not-a-date"), "Not recorded");
    assert.ok(membershipSubmittedDate("2026-10-14T04:00:00Z").includes("2026"));
});
