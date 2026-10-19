import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const readSource = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("dashboard job footer navigates by database ID and Jobs page restores the selected modal from the URL", () => {
    const dashboard = readSource("../src/pages/Alumnipage.jsx");
    const jobs = readSource("../src/pages/JobsPage.jsx");
    assert.match(dashboard, /navigate\(`\/jobs\?jobId=\$\{encodeURIComponent\(job\.id\)\}`\)/);
    assert.match(dashboard, /className="alu-job-footer alu-job-footer-link"/);
    assert.match(jobs, /useSearchParams/);
    assert.match(jobs, /String\(item\.id\) === requestedJobId/);
    assert.match(jobs, /handleOpenJobDetails\(job\)/);
    assert.match(jobs, /That job is unavailable or may have been removed/);
});

test("feed edit opens a visible selected-post dialog and preserves failed edits", () => {
    const feed = readSource("../src/pages/FeedPage.jsx");
    const css = readSource("../src/pages/FeedPage.css");
    assert.match(feed, /postMenuRefs\.current\[post\.id\]/);
    assert.match(feed, /setEditingPost\(post\)/);
    assert.match(feed, /setEditText\(post\?\.text \|\| ""\)/);
    assert.match(feed, /className="feed-edit-dialog post-edit-modal"/);
    assert.doesNotMatch(feed, /className="modal post-edit-modal"/);
    assert.match(css, /\.feed-edit-dialog\s*\{[^}]*display:\s*block/s);
    assert.match(css, /\.modal-overlay\s*\{[^}]*z-index:\s*1200/s);
    assert.match(feed, /onMouseDown=\{\(event\) => event\.stopPropagation\(\)\}/);
    assert.match(feed, /Save Changes/);
    assert.match(feed, /setEditError\(err\.message \|\| "Your changes could not be saved/);
    assert.match(feed, /post\.id === editingPost\.id/);
    assert.match(feed, /await api\.put\(/);
});

test("feed delete remains confirmed, single-flight, and connected to the API", () => {
    const feed = readSource("../src/pages/FeedPage.jsx");
    assert.match(feed, /if \(!editText\.trim\(\)\)/);
    assert.match(feed, /setDeleteConfirmPost\(post\)/);
    assert.match(feed, /await api\.delete\(`\/posts\/\$\{post\.sourceId\}`/);
    assert.match(feed, /This permanently deletes this post and its comments/);
    assert.match(feed, /disabled=\{Boolean\(deletingPostId\)\}/);
});
