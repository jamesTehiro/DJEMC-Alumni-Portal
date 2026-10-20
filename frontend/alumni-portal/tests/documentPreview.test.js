import test from "node:test";
import assert from "node:assert/strict";
import { prepareDocumentBlob } from "../src/utils/documentPreview.js";

test("PDF bytes override image metadata without changing the original", async () => {
    const input = new Blob(["%PDF-1.7 original multipage bytes"], { type: "image/png" });
    const result = await prepareDocumentBlob(input);
    assert.equal(result.type, "application/pdf");
    assert.equal(result.image, false);
    assert.equal(await result.blob.text(), await input.text());
});

test("images with generic metadata are detected and Office documents remain downloads", async () => {
    for (const [bytes, mime, image] of [
        [[137,80,78,71,13,10,26,10], "image/png", true],
        [[255,216,255,224], "image/jpeg", true],
        [new TextEncoder().encode("GIF89a original"), "image/gif", true],
        [new TextEncoder().encode("RIFF1234WEBP"), "image/webp", true],
        [[80,75,3,4,0,0], "application/vnd.openxmlformats-officedocument.wordprocessingml.document", false],
        [[208,207,17,224,161,177,26,225], "application/msword", false],
        [new TextEncoder().encode("<html>unexpected login page</html>"), "application/octet-stream", false]
    ]) {
        const input = new Blob([new Uint8Array(bytes)], { type: "application/octet-stream" });
        const result = await prepareDocumentBlob(input);
        assert.equal(result.type, mime);
        assert.equal(result.image, image);
        assert.deepEqual(await result.blob.arrayBuffer(), await input.arrayBuffer());
    }
});
