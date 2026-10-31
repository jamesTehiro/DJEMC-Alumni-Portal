"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const db = require("../models");
const controller = require("../controllers/jobController");
const notifications = require("../controllers/notificationController");
const audit = require("../services/auditService");
const employerAccess = require("../middleware/employerAccess");
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
const employer = { id: 18, role: "employer", account_status: "verified" };
const admin = { id: 27, role: "admin", admin_scope: "employer", account_status: "verified" };

async function update({ user = employer, input = { title: "Corrected title" }, failRequirement = false } = {}, check) {
    const job = { id: 44, employer_id: 18, title: "Original title", description: "Original description", recruitment_status: "closed", approval_status: "approved", createdAt: "2026-10-01", expected_salary: "Legacy salary text", current_requirement_version: 1, has_requirements: true, posting_details: { compensation: { display: "range", min: 100, max: 200, period: "daily" }, benefits: { government: ["SSS"] } } };
    const state = { job, writes: [], requirements: [{ job_id: 44, version: 1, requirement_code: "custom_portfolio", label: "Portfolio" }], groups: [], application: { id: 71, job_id: 44, status: "pending", snapshot: { version: 1, requirements: [{ label: "Portfolio" }] }, files: ["original.pdf"] }, notifications: [], locks: [], rolledBack: false };
    const originalState = structuredClone({ job: state.job, application: state.application, requirements: state.requirements });
    const transaction = { LOCK: { UPDATE: "UPDATE" } };
    const overrides = [
        [db.User, { findByPk: async () => user }],
        [db.Job, { findByPk: async (id, options) => { if (options?.lock) state.locks.push(options); return job; }, update: async (fields, options) => { assert.equal(options.transaction, transaction); state.writes.push(fields); Object.assign(job, fields, { updatedAt: "2026-10-31" }); }, create: async () => { throw Error("Editing must never create a job"); } }],
        [db.JobRequirement, { max: async () => Math.max(...state.requirements.map(item => item.version)), create: async (fields, options) => { assert.equal(options.transaction, transaction); if (failRequirement) throw Error("Injected failure"); state.requirements.push(fields); return fields; }, destroy: async () => { throw Error("Historical requirements must not be deleted"); } }],
        [db.RequirementGroup, { create: async fields => { const group = { ...fields, id: 99 }; state.groups.push(group); return group; } }],
        [db.Application, { update: async () => { throw Error("Applications must not be modified"); }, destroy: async () => { throw Error("Applications must not be deleted"); } }],
        [db.JobRequirementSnapshot, { update: async () => { throw Error("Snapshots must not be modified"); }, destroy: async () => { throw Error("Snapshots must not be deleted"); } }],
        [db.sequelize, { transaction: async callback => { try { return await callback(transaction); } catch (error) { state.rolledBack = true; throw error; } } }],
        [notifications, { createNotification: async notification => state.notifications.push(notification) }],
        [audit, { log: async () => null }]
    ];
    const originals = overrides.map(([target, values]) => [target, Object.fromEntries(Object.keys(values).map(key => [key, target[key]]))]);
    overrides.forEach(([target, values]) => Object.assign(target, values));
    try {
        const res = response();
        await controller.updateJob({ user: { id: user?.id }, params: { id: 44 }, body: input }, res);
        assert.deepEqual(state.application, originalState.application);
        assert.deepEqual(state.requirements[0], originalState.requirements[0]);
        assert.deepEqual(state.notifications, []);
        await check(res, state);
    } finally { originals.forEach(([target, values]) => Object.assign(target, values)); }
}

for (const user of [employer, admin]) test(`${user.role} updates the original job and preserves status, ownership, applicants and notifications`, async () => {
    await update({ user, input: { title: "Corrected title", employer_id: 999, id: 999, recruitment_status: "active", approval_status: "pending", createdAt: "changed", current_requirement_version: 99 } }, (res, state) => {
        assert.equal(res.statusCode, 200); assert.equal(res.body.id, 44); assert.equal(state.writes.length, 1);
        assert.deepEqual(state.writes[0], { title: "Corrected title" });
        assert.equal(state.job.employer_id, 18); assert.equal(state.job.recruitment_status, "closed"); assert.equal(state.job.approval_status, "approved"); assert.equal(state.job.createdAt, "2026-10-01"); assert.equal(state.job.updatedAt, "2026-10-31");
        assert.equal(state.job.current_requirement_version, 1); assert.equal(state.locks.length, 1);
    });
});

for (const user of [null, { ...employer, id: 19 }, { ...employer, account_status: "pending" }, { ...admin, admin_scope: "alumni" }, { ...admin, admin_scope: "all" }, { ...admin, account_status: "suspended" }, { id: 18, role: "alumni", account_status: "verified" }]) test(`unauthorized update is rejected: ${JSON.stringify(user)}`, async () => {
    await update({ user }, (res, state) => { assert.ok([401, 403].includes(res.statusCode)); assert.equal(state.writes.length, 0); });
});

test("requirements are appended as a new version with groups, codes and all original metadata preserved", async () => {
    const requirement = { requirement_code: "custom_portfolio", label: "Updated portfolio", description: "Original instructions", requirement_type: "information_field", value_type: "select", value_options: ["Yes", "No"], required: true, is_custom: true, allowed_types: "pdf", max_file_size: 4096, condition_enabled: true, condition_field: "experience", condition_operator: "equals", condition_value: "yes", group_temp_id: "old_group" };
    await update({ input: { requirements: [requirement], groups: [{ tempId: "old_group", label: "Original group" }] } }, (res, state) => {
        assert.equal(res.statusCode, 200); assert.equal(state.job.current_requirement_version, 2); assert.equal(state.requirements.length, 2);
        const created = state.requirements[1];
        for (const key of ["requirement_code", "description", "value_type", "value_options", "max_file_size", "condition_enabled", "condition_field", "condition_operator", "condition_value"]) assert.deepEqual(created[key], requirement[key], key);
        assert.equal(created.group_id, 99); assert.equal(created.version, 2); assert.equal(state.groups[0].version, 2);
    });
});

test("removing current requirements keeps historical requirements and application snapshots", async () => {
    await update({ input: { requirements: [] } }, (res, state) => { assert.equal(res.statusCode, 200); assert.equal(state.job.has_requirements, false); assert.equal(state.job.current_requirement_version, 0); assert.equal(state.requirements.length, 1); });
});

test("hidden salary and benefits remain unchanged when edited form omits them", async () => {
    await update({ input: { posting_details: { work_setup: "remote", industry: "Education" } } }, (res, state) => {
        assert.equal(res.statusCode, 200); assert.equal(state.job.expected_salary, "Legacy salary text");
        assert.deepEqual(state.job.posting_details.compensation, { display: "range", min: 100, max: 200, period: "daily" });
        assert.deepEqual(state.job.posting_details.benefits, { government: ["SSS"] });
    });
});

test("invalid fields and failed requirement writes cannot partially update the job", async () => {
    for (const input of [{ title: " " }, { employment_type: "unknown" }, { posting_details: { work_setup: "invalid" } }, { requirements: [{ label: "" }] }]) {
        await update({ input }, (res, state) => { assert.equal(res.statusCode, 400); assert.equal(state.writes.length, 0); });
    }
    await update({ input: { title: "Changed", requirements: [{ label: "Document", requirement_type: "document_upload" }] }, failRequirement: true }, (res, state) => { assert.equal(res.statusCode, 500); assert.equal(state.writes.length, 0); assert.equal(state.rolledBack, true); });
});

test("the existing PUT route requires authentication and permits only employer roles", async () => {
    const router = require("../routes/jobRoutes");
    const route = router.stack.find(layer => layer.route?.path === "/:id" && layer.route.methods.put).route;
    assert.equal(route.stack[0].handle, require("../middleware/authMiddleware"));
    assert.equal(route.stack[1].handle, employerAccess); assert.equal(route.stack[2].handle, controller.updateJob);
    const app = express(); app.use("/jobs", router);
    const server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
    try { assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/jobs/44`, { method: "PUT" })).status, 401); }
    finally { await new Promise(resolve => server.close(resolve)); }
});

test.after(async () => { await db.sequelize.close(); });
