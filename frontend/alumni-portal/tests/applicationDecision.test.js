import test from "node:test";
import assert from "node:assert/strict";
import { applicationDecisionFeedback, canDecideApplication, saveApplicationDecision, updateActiveApplications } from "../src/features/jobs/utils/applicationDecision.js";
import { applicationStatusLabel } from "../src/features/jobs/utils/applicationStatus.js";

const application = { id: 8, job_id: 12, recruitment_cycle: 3, status: "pending", ApplicationDocuments: [{ id: 7 }] };
test("both portals distinguish queueing, processing, provider acceptance and failure", () => {
    const result = { msg: "Application selected for interview." };
    assert.equal(applicationDecisionFeedback(result), result.msg);
    const queued = applicationDecisionFeedback({ ...result, email: { status: "queued" } });
    assert.match(queued, /queued for delivery/); assert.doesNotMatch(queued, /sent|accepted|delivered/);
    assert.match(applicationDecisionFeedback({ ...result, email: { status: "processing" } }), /being processed/);
    assert.match(applicationDecisionFeedback({ ...result, email: { status: "sent" } }), /inbox delivery is not confirmed/);
    assert.match(applicationDecisionFeedback({ ...result, email: { status: "failed" } }), /notification failed/);
    assert.match(applicationDecisionFeedback({ ...result, email: { status: "failed", reason: "enqueue_failed" } }), /could not be queued/);
    assert.match(applicationDecisionFeedback({ ...result, email: { status: "failed", reason: "invalid_registered_email" } }), /unavailable for this registered account/);
});
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
    assert.equal(applicationStatusLabel(approved[0].status), "FOR INTERVIEW");
    assert.equal(approved[0].ApplicationDocuments, application.ApplicationDocuments);
    assert.deepEqual(updateActiveApplications(approved, 8, "not_verified"), [other]);
    assert.equal(application.status, "pending");
});
test("failed decisions propagate server error and leave records untouched", async () => {
    await assert.rejects(saveApplicationDecision(application, "verified", { async put() { throw Error("Wrong recruitment cycle"); } }, () => true), /Wrong recruitment cycle/);
    assert.equal(application.status, "pending");
});

test("job application terminology maps display text while preserving stored statuses and declined labels", () => {
    for (const status of ["pending", "pending_review", "submitted", undefined, null]) assert.equal(applicationStatusLabel(status), "PENDING REVIEW");
    for (const status of ["verified", "approved", "ready_for_interview"]) assert.equal(applicationStatusLabel(status), "FOR INTERVIEW");
    assert.equal(applicationStatusLabel("not_verified"), "DECLINED");
    assert.equal(applicationStatusLabel("declined"), "DECLINED");
    assert.equal(applicationStatusLabel("rejected"), "REJECTED");
    assert.equal(applicationStatusLabel("processing"), "PROCESSING");
    assert.equal(application.status, "pending");
});
