const test = require("node:test");
const assert = require("node:assert/strict");
const profileController = require("../controllers/profileController");

test("profile image URLs preserve shared Cloudinary URLs and canonicalize local upload names", () => {
    assert.equal(profileController.normalizeStoredImagePath("https://res.cloudinary.com/example/image/upload/avatar.jpg"), "https://res.cloudinary.com/example/image/upload/avatar.jpg");
    assert.equal(profileController.normalizeStoredImagePath("/uploads/avatar.jpg"), "/uploads/images/avatar.jpg");
    assert.equal(profileController.buildCanonicalImagePath("C:\\temp\\avatar.jpg"), "/uploads/images/avatar.jpg");
});

test("profile image paths reject temporary browser and machine-local file references", () => {
    for (const value of ["blob:https://firebase.example/id", "data:image/png;base64,abcd", "file:///C:/photo.png", "C:\\Alumni\\backend\\uploads\\images\\photo.png"]) {
        assert.throws(() => profileController.normalizeStoredImagePath(value), { status: 400 });
    }
});

test("multipart profile payload is decoded and sanitized before saving", () => {
    assert.deepEqual(profileController.parseProfilePayload({ payload: JSON.stringify({ name: " Alumni ", avatar_url: "https://res.cloudinary.com/example/avatar.jpg" }) }), {
        name: "Alumni", avatar_url: "https://res.cloudinary.com/example/avatar.jpg"
    });
    assert.throws(() => profileController.parseProfilePayload({ payload: "not-json" }), { status: 400 });
    assert.throws(() => profileController.parseProfilePayload({ payload: "[]" }), { status: 400 });
});
