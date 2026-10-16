import test from "node:test";
import assert from "node:assert/strict";
import { canDecideApplication, saveApplicationDecision, updateActiveApplications } from "../src/utils/applicationDecision.js";
import { applicationStatusLabel } from "../src/utils/applicationStatus.js";

const application = { id: 8, job_id: 12, recruitment_cycle: 3, status: "pending", ApplicationDocuments: [{ id: 7 }] };
test("both decision controls allow only pending applications and lock while processing", () => {
    for (const status of ["pending", "pending_review", "submitted"]) {
        assert.equal(canDecideApplication({ ...application, status }), true);
        assert.equal(canDecideApplication({ ...application, status }, true), false);
    }
    for (const status of ["verified", "approved", "ready_for_interview", "not_verified", "declined", "rejected", "processing", "", null, "unknown"]) {
        assert.equal(canDecideApplication({ ...application, status }), false);
    }
    assert.equal(canDecideApplication(null), false);
});
test("saved final decisions cannot submit another request or confirmation", async () => {
    for (const status of ["verified", "not_verified", "approved", "declined", "processing"]) {
        const unexpected = () => { throw Error("Locked decision must not be submitted"); };
        assert.equal(await saveApplicationDecision({ ...application, status }, "not_verified", { put: unexpected }, unexpected), null);
    }
});
test("canceling decline sends no request and leaves all records unchanged", async () => {
    const original = structuredClone(application);
    let calls = 0;
    assert.equal(await saveApplicationDecision(application, "not_verified", { put() { calls++; } }, message => {
        assert.match(message, /removed from the active applicant list/);
        assert.match(message, /documents will be retained/);
        return false;
    }), null);
    assert.equal(calls, 0);
    assert.deepEqual(application, original);
});
test("approve and confirmed decline send job and cycle context to the server", async () => {
    for (const status of ["verified", "not_verified"]) {
        const api = { async put(path, body, auth) {
            assert.equal(path, "/applications/8/review");
            assert.deepEqual(body, { status, job_id: 12, recruitment_cycle: 3 });
            assert.equal(auth, true);
            return { application: { ...application, status } };
        } };
        assert.equal((await saveApplicationDecision(application, status, api, () => true)).application.status, status);
    }
});
test("approved grouping and declined counts update without changing other applications or documents", () => {
    const other = { id: 99, job_id: 44, recruitment_cycle: 1, status: "pending" };
    const approved = updateActiveApplications([application, other], 8, "verified");
    assert.equal(approved.filter(app => app.status === "pending").length, 1);
    assert.equal(approved.filter(app => app.status === "verified").length, 1);
    assert.equal(applicationStatusLabel(approved[0].status), "APPROVED");
    assert.equal(approved[0].ApplicationDocuments, application.ApplicationDocuments);
    assert.deepEqual(updateActiveApplications(approved, 8, "not_verified"), [other]);
    assert.equal(application.status, "pending");
});
test("failed decisions propagate server error and leave records untouched", async () => {
    await assert.rejects(saveApplicationDecision(application, "verified", { async put() { throw Error("Wrong recruitment cycle"); } }, () => true), /Wrong recruitment cycle/);
    assert.equal(application.status, "pending");
});
