import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runSingleFlight } from "../src/utils/postSubmission.js";

test("single-flight guard allows one request during rapid duplicate submissions", async () => {
    const inFlightRef = { current: false };
    let calls = 0;
    let finishRequest;
    const requestGate = new Promise((resolve) => { finishRequest = resolve; });

    const first = runSingleFlight(inFlightRef, async () => {
        calls += 1;
        await requestGate;
    });
    const duplicate = await runSingleFlight(inFlightRef, async () => { calls += 1; });

    assert.equal(duplicate, false);
    assert.equal(inFlightRef.current, true);
    assert.equal(calls, 1);
    finishRequest();
    assert.equal(await first, true);
    assert.equal(inFlightRef.current, false);
});

test("single-flight guard resets after a failed upload so the draft can be retried", async () => {
    const inFlightRef = { current: false };
    const draft = "Retry this post";

    await assert.rejects(
        runSingleFlight(inFlightRef, async () => { throw new Error("Upload failed"); }),
        /Upload failed/
    );
    assert.equal(inFlightRef.current, false);

    let retriedDraft;
    assert.equal(await runSingleFlight(inFlightRef, async () => { retriedDraft = draft; }), true);
    assert.equal(retriedDraft, draft);
});

test("Feed composer keeps its draft on failure and clears it only after a successful create", () => {
    const source = readFileSync(new URL("../src/pages/FeedPage.jsx", import.meta.url), "utf8");
    assert.match(source, /const postSubmissionRef = useRef\(false\)/);
    assert.match(source, /runSingleFlight\(postSubmissionRef/);
    assert.match(source, /disabled=\{isPosting\}/);
    assert.match(source, /FiLoader className="post-btn-spinner"/);
    assert.match(source, /<span>Posting\.\.\.<\/span>/);
    assert.match(source, /type="button"[\s\S]*?onClick=\{submitPost\}[\s\S]*?disabled=\{isPosting\}/);

    const successIndex = source.indexOf("setText(\"\");", source.indexOf("const submitPost"));
    const failureIndex = source.indexOf("catch (err)", source.indexOf("const submitPost"));
    assert.ok(successIndex > -1 && failureIndex > successIndex, "clear the composer only on the success path");
    assert.match(source.slice(failureIndex, source.indexOf("finally", failureIndex)), /setPostNotice\(\{ type: "error", message: err\.message/);
    assert.doesNotMatch(source.slice(failureIndex, source.indexOf("finally", failureIndex)), /setText\(/);
});
