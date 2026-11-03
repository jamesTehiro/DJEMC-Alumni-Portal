const test = require("node:test");
const assert = require("node:assert/strict");
const { Op } = require("sequelize");
const { createReminders, INTERVAL_MS, MESSAGE, TYPE, enabled } = require("../services/alumniProfileReminders");

function fixture() {
    let now = new Date("2026-11-03T00:00:00Z"), tail = Promise.resolve();
    const old = new Date(now.getTime() - INTERVAL_MS);
    const state = { users: [{ id: 1, role: "alumni", account_status: "verified", name: "Fixture Alum", email: "alum@example.invalid", createdAt: old }], profiles: [{ id: 10, user_id: 1, updatedAt: old }], schedules: [], notifications: [], fail: null };
    const row = (values, transaction, kind) => ({ ...values, update: async updates => {
        assert.ok(transaction);
        if (state.fail === kind) throw new Error("Injected persistence failure");
        Object.assign(values, updates);
    } });
    const db = {
        sequelize: {
            query: async (sql, options) => { assert.match(sql, /CURRENT_TIMESTAMP/); assert.ok(options.transaction); return [{ current_time: now }]; },
            transaction: async callback => {
                const previous = tail; let release;
                tail = new Promise(resolve => { release = resolve; }); await previous;
                const before = structuredClone(state), transaction = { LOCK: { UPDATE: "UPDATE" }, ownerLocked: false };
                try { return await callback(transaction); }
                catch (error) { Object.assign(state, before); throw error; }
                finally { release(); }
            }
        },
        User: {
            findByPk: async (id, options) => {
                assert.ok(options.transaction);
                if (options.lock) { assert.equal(options.lock, "UPDATE"); options.transaction.ownerLocked = true; }
                const user = state.users.find(user => user.id === id);
                if (!user) return null;
                return row(user, options.transaction, "user");
            },
            findAll: async options => {
                assert.equal(options.where.role, "alumni"); assert.equal(options.where.account_status, "verified");
                assert.equal(options.limit, 100);
                return state.users.filter(user => user.role === "alumni" && user.account_status === "verified" && user.id > options.where.id[Op.gt]).sort((a, b) => a.id - b.id).slice(0, options.limit);
            }
        },
        AlumniProfile: {
            findOne: async options => { assert.ok(options.transaction.ownerLocked); return state.profiles.find(profile => profile.user_id === options.where.user_id) || null; },
            findOrCreate: async options => [row(state.profiles.find(profile => profile.user_id === options.where.user_id), options.transaction, "profile")]
        },
        AlumniProfileReminder: {
            findByPk: async (id, options) => {
                assert.ok(options.transaction.ownerLocked, "Owner locked before clock lookup"); assert.equal(options.lock, "UPDATE");
                const values = state.schedules.find(item => item.user_id === id);
                return values ? row(values, options.transaction, "schedule") : null;
            },
            create: async (values, options) => {
                assert.ok(options.transaction.ownerLocked); assert.ok(!state.schedules.some(item => item.user_id === values.user_id));
                state.schedules.push(values); return row(values, options.transaction, "schedule");
            }
        },
        Notification: {
            create: async (values, options) => { assert.ok(options.transaction.ownerLocked); if (state.fail === "notification") throw new Error("Injected persistence failure"); const notification = { id: state.notifications.length + 1, ...values }; state.notifications.push(notification); return notification; },
            findByPk: async id => {
                const values = state.notifications.find(item => item.id === Number(id));
                return values ? { ...values, save: async function () { Object.assign(values, { isRead: this.isRead }); }, destroy: async () => { state.notifications = state.notifications.filter(item => item.id !== values.id); } } : null;
            },
            findAll: async options => state.notifications.filter(item => item.userId === options.where.userId)
        }
    };
    return { state, db, service: createReminders({ db }), advance: milliseconds => { now = new Date(now.getTime() + milliseconds); }, now: () => now };
}

test("first eligible reminder uses the existing in-app notification and exact optional wording", async () => {
    const { state, service, now } = fixture();
    assert.equal(await service.runOnce(), 1);
    assert.deepEqual(state.notifications[0], { id: 1, userId: 1, type: TYPE, message: MESSAGE, isRead: false });
    assert.equal(state.schedules[0].last_reminded_at.getTime(), now().getTime());
    assert.equal(state.schedules[0].next_reminder_at.getTime(), now().getTime() + INTERVAL_MS);
});

test("new accounts wait 30 days; latest existing profile save is the initial baseline", async () => {
    const { state, service, now, advance } = fixture();
    state.profiles[0].updatedAt = now();
    assert.equal(await service.runOnce(), 0);
    advance(INTERVAL_MS - 1); assert.equal(await service.runOnce(), 0);
    advance(1); assert.equal(await service.runOnce(), 1);
});

test("repeated executions and restarted services cannot duplicate a reminder within 30 days", async () => {
    const { state, db, service, advance } = fixture();
    await service.runOnce();
    advance(INTERVAL_MS - 1);
    assert.equal(await createReminders({ db }).runOnce(), 0);
    advance(1);
    assert.equal(await createReminders({ db }).runOnce(), 1);
    assert.equal(state.notifications.length, 2);
});

test("multiple scheduler instances serialize the first insert and every subsequent cycle", async () => {
    const { state, db, advance } = fixture();
    const run = () => Promise.all(Array.from({ length: 8 }, () => createReminders({ db }).runOnce()));
    assert.equal((await run()).reduce((a, b) => a + b), 1);
    advance(INTERVAL_MS);
    assert.equal((await run()).reduce((a, b) => a + b), 1);
    assert.equal(state.notifications.length, 2); assert.equal(state.schedules.length, 1);
});

test("profile/name saves made while the worker is paused postpone an existing schedule", async () => {
    for (const target of ["profile", "user"]) {
        const { state, service, advance, now } = fixture();
        await service.runOnce(); advance(20 * 86400000);
        (target === "profile" ? state.profiles[0] : state.users[0]).updatedAt = now();
        advance(10 * 86400000); assert.equal(await service.runOnce(), 0);
        advance(20 * 86400000); assert.equal(await service.runOnce(), 1);
        assert.equal(state.notifications.length, 2);
    }
});

test("one failed account does not starve later accounts when the worker supplies an error handler", async () => {
    const { state, db, service } = fixture();
    state.users.push({ ...state.users[0], id: 2 });
    const create = db.Notification.create;
    db.Notification.create = (values, options) => { if (values.userId === 1) throw new Error("Fixture storage failure"); return create(values, options); };
    let failures = 0;
    assert.equal(await service.runOnce({ onError: () => { failures++; } }), 1);
    assert.equal(failures, 1); assert.equal(state.notifications[0].userId, 2);
    assert.equal(state.schedules.length, 1);
});

test("non-Alumni, unverified, suspended and deleted accounts are excluded and eligibility is rechecked under lock", async () => {
    const { state, service } = fixture();
    for (const [index, [role, status]] of [["employer", "verified"], ["admin", "verified"], ["registrar", "verified"], ["alumni", "pending"], ["alumni", "suspended"], ["alumni", "deleted"]].entries()) {
        state.users.push({ id: index + 2, role, account_status: status, createdAt: state.users[0].createdAt });
        assert.equal(await service.remindUser(index + 2), false);
    }
    assert.equal(await service.remindUser(999), false);
    assert.equal(await service.runOnce(), 1); assert.equal(state.schedules.length, 1);
});

test("keyset scheduler processes all eligible accounts across batches", async () => {
    const { state, service } = fixture();
    for (let id = 2; id <= 205; id++) state.users.push({ ...state.users[0], id });
    assert.equal(await service.runOnce(), 205);
    assert.equal(new Set(state.notifications.map(row => row.userId)).size, 205);
});

for (const stage of ["notification", "schedule"]) test(`failure at ${stage} rolls back the notification and clock, then retries safely`, async () => {
    const { state, service } = fixture(); state.fail = stage;
    await assert.rejects(service.runOnce(), /Injected persistence failure/);
    assert.equal(state.notifications.length, 0); assert.equal(state.schedules.length, 0);
    state.fail = null; assert.equal(await service.runOnce(), 1);
});

const realDb = require("../models");
const originalSequelize = realDb.sequelize;
test.after(() => originalSequelize.close());
async function withModels(db, callback) {
    const original = {};
    for (const key of Object.keys(db)) { original[key] = realDb[key]; realDb[key] = db[key]; }
    try { await callback(); } finally { Object.assign(realDb, original); }
}
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

test("read and dismiss use existing ownership-checked APIs and dismissal cannot recreate the same cycle", async () => {
    const { state, db, service } = fixture(); await service.runOnce();
    await withModels(db, async () => {
        const controller = require("../controllers/notificationController");
        const forbidden = response(); await controller.deleteNotification({ user: { id: 2 }, params: { id: 1 } }, forbidden);
        assert.equal(forbidden.statusCode, 403); assert.equal(state.notifications.length, 1);
        const read = response(); await controller.markAsRead({ user: { id: 1 }, params: { id: 1 } }, read);
        assert.equal(read.statusCode, 200); assert.equal(state.notifications[0].isRead, true);
        const dismissed = response(); await controller.deleteNotification({ user: { id: 1 }, params: { id: 1 } }, dismissed);
        assert.equal(dismissed.statusCode, 200);
        const listed = response(); await controller.getUserNotifications({ user: { id: 1 } }, listed);
        assert.deepEqual(listed.body, []);
    });
    assert.equal(await service.runOnce(), 0); assert.equal(state.notifications.length, 0); assert.equal(state.schedules.length, 1);
});

test("successful actual profile saves reset the clock atomically; unsuccessful saves do not postpone reminders", async () => {
    const { state, db, service, advance, now } = fixture();
    const { saveAlumniProfile } = require("../services/alumniProfileSave");
    const previousFlag = process.env.ALUMNI_PROFILE_REMINDERS_ENABLED;
    process.env.ALUMNI_PROFILE_REMINDERS_ENABLED = "true";
    try {
        await service.runOnce(); advance(10 * 86400000);
        await withModels(db, async () => {
            const save = () => saveAlumniProfile({ user: state.users[0], body: { phone: "fixture phone" }, normalizeImagePath: value => value });
            await save();
            assert.equal(state.profiles[0].phone, "fixture phone");
            assert.equal(state.schedules[0].last_profile_updated_at.getTime(), now().getTime());
            const next = state.schedules[0].next_reminder_at.getTime();
            advance(86400000); state.fail = "schedule";
            await assert.rejects(save(), /Injected persistence failure/);
            assert.equal(state.schedules[0].next_reminder_at.getTime(), next);
            state.fail = null;
            advance(29 * 86400000 - 1); assert.equal(await service.runOnce(), 0);
            advance(1); assert.equal(await service.runOnce(), 1);
        });
    } finally {
        if (previousFlag === undefined) delete process.env.ALUMNI_PROFILE_REMINDERS_ENABLED;
        else process.env.ALUMNI_PROFILE_REMINDERS_ENABLED = previousFlag;
    }
});

test("disabled rollout leaves existing profile saves independent of the new table", async () => {
    assert.equal(enabled({}), false); assert.equal(enabled({ ALUMNI_PROFILE_REMINDERS_ENABLED: "true" }), true);
    const { db, state } = fixture();
    const old = process.env.ALUMNI_PROFILE_REMINDERS_ENABLED; process.env.ALUMNI_PROFILE_REMINDERS_ENABLED = "false";
    db.AlumniProfileReminder.findByPk = () => { throw new Error("Must not access unmigrated reminder storage"); };
    try { await withModels(db, () => require("../services/alumniProfileSave").saveAlumniProfile({ user: state.users[0], body: { phone: "fixture" }, normalizeImagePath: value => value })); }
    finally { if (old === undefined) delete process.env.ALUMNI_PROFILE_REMINDERS_ENABLED; else process.env.ALUMNI_PROFILE_REMINDERS_ENABLED = old; }
});
