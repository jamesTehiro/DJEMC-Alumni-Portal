const { Op, QueryTypes } = require("sequelize");

const INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;
const TYPE = "profile_update_reminder";
const TITLE = "Profile Update Reminder";
const MESSAGE = "You may review and update your profile information whenever convenient to help keep your alumni records accurate and up to date. This reminder is optional.";
const enabled = (env = process.env) => env.ALUMNI_PROFILE_REMINDERS_ENABLED === "true";
async function databaseNow(db, transaction) {
    const [row] = await db.sequelize.query("SELECT CURRENT_TIMESTAMP(3) AS current_time", { type: QueryTypes.SELECT, transaction });
    const now = new Date(row.current_time);
    if (!Number.isFinite(now.getTime())) throw new Error("Unable to read reminder database clock.");
    return now;
}

function createReminders({ db, clock = transaction => databaseNow(db, transaction) }) {
    // Called only while the profile-save transaction owns the User row lock.
    async function resetAfterProfileSave(userId, transaction) {
        const now = await clock(transaction);
        const values = { next_reminder_at: new Date(now.getTime() + INTERVAL_MS), last_profile_updated_at: now };
        const state = await db.AlumniProfileReminder.findByPk(userId, { transaction, lock: transaction.LOCK.UPDATE });
        if (state) await state.update(values, { transaction });
        else await db.AlumniProfileReminder.create({ user_id: userId, last_reminded_at: null, ...values }, { transaction });
    }

    async function remindUser(userId) {
        return db.sequelize.transaction(async transaction => {
            // Both scheduler instances and profile saves lock the owner first.
            // This serializes even the first insert, when no schedule row exists.
            const user = await db.User.findByPk(userId, { transaction, lock: transaction.LOCK.UPDATE });
            if (!user || user.role !== "alumni" || user.account_status !== "verified") return false;
            const now = await clock(transaction);
            let state = await db.AlumniProfileReminder.findByPk(userId, { transaction, lock: transaction.LOCK.UPDATE });
            const profile = await db.AlumniProfile.findOne({ where: { user_id: user.id }, attributes: ["updatedAt"], transaction });
            // Also reconcile saves made while reminders were disabled or during
            // a rolling deployment. User.updatedAt covers name/email edits.
            const dates = [user.createdAt, user.updatedAt, profile?.updatedAt].filter(Boolean).map(value => new Date(value).getTime()).filter(Number.isFinite);
            const baseline = dates.length ? Math.max(...dates) : now.getTime();
            if (!state) {
                state = await db.AlumniProfileReminder.create({ user_id: user.id, next_reminder_at: new Date(baseline + INTERVAL_MS), last_reminded_at: null, last_profile_updated_at: new Date(baseline) }, { transaction });
            } else if (dates.length && baseline > new Date(state.last_profile_updated_at || 0).getTime()) {
                const values = { next_reminder_at: new Date(Math.max(new Date(state.next_reminder_at).getTime(), baseline + INTERVAL_MS)), last_profile_updated_at: new Date(baseline) };
                await state.update(values, { transaction });
                Object.assign(state, values);
            }
            if (new Date(state.next_reminder_at).getTime() > now.getTime()) return false;
            // Existing in-app notifications, intentionally no email queue entry.
            await db.Notification.create({ userId: user.id, type: TYPE, message: MESSAGE, isRead: false }, { transaction });
            await state.update({ last_reminded_at: now, next_reminder_at: new Date(now.getTime() + INTERVAL_MS) }, { transaction });
            return true;
        });
    }

    async function runOnce({ shouldStop = () => false, onError } = {}) {
        let afterId = 0, created = 0;
        while (!shouldStop()) {
            const users = await db.User.findAll({ where: { role: "alumni", account_status: "verified", id: { [Op.gt]: afterId } }, attributes: ["id"], order: [["id", "ASC"]], limit: 100 });
            if (!users.length) break;
            for (const user of users) {
                if (shouldStop()) return created;
                try { if (await remindUser(user.id)) created++; }
                catch (error) { if (!onError) throw error; onError(); }
                afterId = user.id;
            }
        }
        return created;
    }
    return { resetAfterProfileSave, remindUser, runOnce };
}

module.exports = { INTERVAL_MS, TYPE, TITLE, MESSAGE, enabled, databaseNow, createReminders };
