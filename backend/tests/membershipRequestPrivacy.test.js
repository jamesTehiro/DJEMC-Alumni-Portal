"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const logger = require("../middleware/requestLogger");

function capture(originalUrl) {
    const previousLog = console.log;
    const previousRequests = process.env.LOG_REQUESTS;
    const lines = [];
    let finish;
    let nextCalled = false;
    try {
        process.env.LOG_REQUESTS = "true";
        console.log = line => lines.push(line);
        logger({ method: "GET", originalUrl }, { statusCode: 200, on(event, callback) { assert.equal(event, "finish"); finish = callback; } }, () => { nextCalled = true; });
        finish(); assert.equal(nextCalled, true); return lines[0];
    } finally {
        console.log = previousLog;
        if (previousRequests === undefined) delete process.env.LOG_REQUESTS;
        else process.env.LOG_REQUESTS = previousRequests;
    }
}

test("membership request logs retain routes/status without private search/filter values", () => {
    for (const path of ["/api/membership/admin", "/api/membership/me", "/API/Membership/admin/4/document", "/api/membership"]) {
        const line = capture(`${path}?search=private%40example.invalid&graduation_year=2026&submitted_date=2026-10-14`);
        assert.ok(line.includes(`GET ${path} 200`)); assert.doesNotMatch(line, /private|search=|graduation_year|submitted_date/);
    }
});

test("the focused membership redaction preserves unrelated request logging", () => {
    const line = capture("/api/jobs?page=2"); assert.match(line, /GET \/api\/jobs\?page=2 200/);
    assert.match(capture("/api/membership-settings?page=2"), /membership-settings\?page=2/);
});
