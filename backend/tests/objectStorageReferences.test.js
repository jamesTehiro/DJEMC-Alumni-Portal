const test = require("node:test");
const assert = require("node:assert/strict");
const { isStoredFileReference, parseStoredFileReference, sendStoredFile } = require("../services/objectStorage");

test("recovers intact Cloudinary fields from a reference truncated after its URL", () => {
    const payload = {
        provider: "cloudinary",
        resourceType: "raw",
        type: "upload",
        publicId: "application-requirements/requirement_tor-123456-123456.pdf",
        url: "https://res.cloudinary.com/test-cloud/raw/upload/v123456/application-requirements/requirement_tor-123456-123456.pdf",
        originalName: `${"transcript-document-".repeat(20)}.pdf`
    };
    const fullReference = `cld:${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`;
    const truncatedReference = fullReference.slice(0, 500);

    assert.equal(fullReference.length > 500, true);
    assert.equal(isStoredFileReference(truncatedReference), true);
    assert.deepEqual(parseStoredFileReference(truncatedReference), {
        provider: payload.provider,
        resourceType: payload.resourceType,
        type: payload.type,
        publicId: payload.publicId,
        url: payload.url
    });
});

test("does not recover truncated references pointing outside Cloudinary", () => {
    const payload = {
        provider: "cloudinary",
        resourceType: "raw",
        type: "upload",
        publicId: "documents/file.pdf",
        url: "http://127.0.0.1/private/file.pdf",
        originalName: `${"large-name-".repeat(80)}.pdf`
    };
    const truncatedReference = `cld:${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`.slice(0, 500);
    assert.equal(isStoredFileReference(truncatedReference), false);
});

test("recovers Cloudinary image references whose delivery URL adds an image extension", () => {
    const payload = {
        provider: "cloudinary",
        resourceType: "image",
        type: "upload",
        publicId: "applications/requirement_photo-123456-123456",
        url: "https://res.cloudinary.com/test-cloud/image/upload/v123456/applications/requirement_photo-123456-123456.jpg",
        originalName: `${"profile-photo-".repeat(50)}.jpg`
    };
    const truncatedReference = `cld:${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`.slice(0, 500);

    assert.equal(isStoredFileReference(truncatedReference), true);
    assert.equal(parseStoredFileReference(truncatedReference).url, payload.url);
});

test("serves a recovered reference through the existing storage download helper", async () => {
    const payload = {
        provider: "cloudinary",
        resourceType: "raw",
        type: "upload",
        publicId: "private_uploads/documents/requirement_file-123456-123456.pdf",
        url: "https://res.cloudinary.com/test-cloud/raw/upload/v123456/private_uploads/documents/requirement_file-123456-123456.pdf",
        originalName: `${"long-requirement-name-".repeat(30)}.pdf`
    };
    const reference = `cld:${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`.slice(0, 500);
    const originalFetch = global.fetch;
    const fileBytes = Buffer.from("%PDF-test-file");
    let requestedUrl = "";
    let sentBody = null;
    const headers = {};
    global.fetch = async (url) => {
        requestedUrl = String(url);
        return {
            ok: true,
            headers: { get: () => "application/pdf" },
            arrayBuffer: async () => fileBytes.buffer.slice(fileBytes.byteOffset, fileBytes.byteOffset + fileBytes.byteLength)
        };
    };

    try {
        await sendStoredFile(reference, {
            setHeader(name, value) { headers[name] = value; },
            send(value) { sentBody = value; }
        }, "original-transcript.pdf", "application/pdf");
        assert.equal(requestedUrl, payload.url);
        assert.deepEqual(sentBody, fileBytes);
        assert.equal(headers["Content-Type"], "application/pdf");
        assert.match(headers["Content-Disposition"], /original-transcript\.pdf/);
    } finally {
        global.fetch = originalFetch;
    }
});
