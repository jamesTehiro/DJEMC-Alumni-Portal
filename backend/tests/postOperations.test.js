const test = require("node:test");
const assert = require("node:assert/strict");
const db = require("../models");
const postController = require("../controllers/postController");

const response = () => ({
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
});

const withOverrides = async (overrides, run) => {
    const originals = overrides.map(([target, values]) => [
        target,
        Object.fromEntries(Object.keys(values).map((key) => [key, target[key]]))
    ]);
    for (const [target, values] of overrides) Object.assign(target, values);
    try {
        await run();
    } finally {
        for (const [target, values] of originals) Object.assign(target, values);
    }
};

test.after(async () => {
    await db.sequelize.close();
});

test("post update requires text and preserves the existing attachment when omitted", async () => {
    const post = {
        id: 71,
        user_id: 12,
        text: "Before",
        image_url: "/uploads/post.png",
        async save() { this.saved = true; },
        toJSON() { return { id: this.id, text: this.text, image_url: this.image_url }; }
    };
    await withOverrides([[db.Post, { findByPk: async () => post }]], async () => {
        const res = response();
        await postController.updatePost({ params: { postId: "71" }, user: { id: "12" }, body: { text: "  After  " } }, res);
        assert.equal(res.statusCode, 200);
        assert.equal(post.text, "After");
        assert.equal(post.image_url, "/uploads/post.png");
        assert.equal(post.saved, true);

        const empty = response();
        await postController.updatePost({ params: { postId: "71" }, user: { id: 12 }, body: { text: "   " } }, empty);
        assert.equal(empty.statusCode, 400);
        assert.equal(post.text, "After");
    });
});

test("only the owner can edit; alumni scoped admins can delete but other roles cannot", async () => {
    let saved = false;
    let destroyed = false;
    const post = {
        id: 72,
        user_id: 12,
        async save() { saved = true; },
        async destroy() { destroyed = true; }
    };
    await withOverrides([
        [db.Post, { findByPk: async () => post }],
        [db.Comment, { destroy: async () => ({}) }]
    ], async () => {
        const editRes = response();
        await postController.updatePost({ params: { postId: "72" }, user: { id: 99, role: "admin", admin_scope: "alumni" }, body: { text: "Takeover" } }, editRes);
        assert.equal(editRes.statusCode, 403);
        assert.equal(saved, false);

        const deniedDelete = response();
        await postController.deletePost({ params: { postId: "72" }, user: { id: 99, role: "admin", admin_scope: "employer" } }, deniedDelete);
        assert.equal(deniedDelete.statusCode, 403);
        assert.equal(destroyed, false);

        const adminDelete = response();
        await postController.deletePost({ params: { postId: "72" }, user: { id: 99, role: "admin", admin_scope: "alumni" } }, adminDelete);
        assert.equal(adminDelete.statusCode, 200);
        assert.equal(destroyed, true);
    });
});
