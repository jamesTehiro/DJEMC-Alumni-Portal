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

test("feed actions retain per-post menus, validate edits, and confirm deletion before calling the API", () => {
    const feed = readSource("../src/pages/FeedPage.jsx");
    assert.match(feed, /postMenuRefs\.current\[post\.id\]/);
    assert.match(feed, /if \(!editText\.trim\(\)\)/);
    assert.match(feed, /setDeleteConfirmPost\(post\)/);
    assert.match(feed, /await api\.delete\(`\/posts\/\$\{post\.sourceId\}`/);
    assert.match(feed, /This permanently deletes this post and its comments/);
    assert.match(feed, /disabled=\{Boolean\(deletingPostId\)\}/);
});
