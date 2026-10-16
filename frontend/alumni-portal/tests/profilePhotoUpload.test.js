import test from "node:test";
import assert from "node:assert/strict";
import { createProfilePhotoFormData, PROFILE_PHOTO_MAX_BYTES, validateProfilePhoto } from "../src/utils/profilePhotoUpload.js";

test("profile photo validation keeps the supported image types and size limit", () => {
    assert.equal(validateProfilePhoto({ type: "image/jpeg", size: 1024 }), "");
    assert.match(validateProfilePhoto({ type: "image/svg+xml", size: 1024 }), /PNG, JPG, WebP, or GIF/);
    assert.match(validateProfilePhoto({ type: "image/png", size: PROFILE_PHOTO_MAX_BYTES + 1 }), /5 MB or smaller/);
});

test("profile photo upload sends the profile payload and file as multipart fields", () => {
    const file = new File(["photo"], "photo.png", { type: "image/png" });
    const payload = { name: "Alumni", avatar_url: "" };
    const form = createProfilePhotoFormData(payload, file);
    assert.deepEqual(JSON.parse(form.get("payload")), payload);
    assert.equal(form.get("avatar_image").name, "photo.png");
});

test("Admin Alumni profile drawer keeps three tabs and the update-request action without Notes", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(new URL("../src/pages/admin/AdminUsersPage.jsx", import.meta.url), "utf8");
    assert.match(source, /\["overview", "employment", "tracking"\]/);
    assert.doesNotMatch(source, /profileTab === "notes"|"tracking", "notes"/);
    assert.match(source, /Request Profile Update/);
});
