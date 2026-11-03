require("../config/adminOtpEnvironment");
require("dotenv").config({ path: require("node:path").join(__dirname, "../.env") });
const db = require("../models");
const { enabled, createReminders } = require("../services/alumniProfileReminders");
const schema = require("../migrations/20261103-create-alumni-profile-reminders");

function pollInterval(env = process.env) {
    const milliseconds = Number(env.ALUMNI_PROFILE_REMINDER_POLL_MS || 3600000);
    if (!Number.isSafeInteger(milliseconds) || milliseconds < 60000 || milliseconds > 2147483647) throw new Error("ALUMNI_PROFILE_REMINDER_POLL_MS must be between 60000 and 2147483647.");
    return milliseconds;
}

async function main({ checkOnly = false } = {}) {
    const interval = pollInterval();
    if (!checkOnly && !enabled()) { console.log("Alumni profile reminders disabled."); return; }
    try {
        await db.sequelize.authenticate();
        const changes = await schema.inspect(db.sequelize.getQueryInterface());
        if (changes.length) throw new Error("Apply the Alumni profile reminder migration before enabling reminders.");
        if (checkOnly) { console.log(JSON.stringify({ enabled: enabled(), schemaReady: true, pollMs: interval, inAppOnly: true })); return; }
        const reminders = createReminders({ db });
        let stopping = false, wake;
        const stop = () => { stopping = true; wake?.(); };
        process.once("SIGTERM", stop); process.once("SIGINT", stop); process.once("disconnect", stop);
        try {
            while (!stopping) {
                try { await reminders.runOnce({ shouldStop: () => stopping, onError: () => console.error("[ALUMNI_PROFILE_REMINDER_ACCOUNT_FAILED] Account transaction rolled back; retrying on next poll.") }); }
                catch { console.error("[ALUMNI_PROFILE_REMINDER_RUN_FAILED] Schedule retained; retrying on next poll."); }
                if (!stopping) await new Promise(resolve => {
                    const timer = setTimeout(resolve, interval);
                    wake = () => { clearTimeout(timer); resolve(); };
                });
            }
        } finally {
            process.removeListener("SIGTERM", stop); process.removeListener("SIGINT", stop); process.removeListener("disconnect", stop);
        }
    } finally { await db.sequelize.close(); }
}
if (require.main === module) main({ checkOnly: process.argv.includes("--check") }).catch(() => {
    console.error("[ALUMNI_PROFILE_REMINDER_START_FAILED] Review reminder configuration, migration and database access.");
    process.exitCode = 1;
});
module.exports = { main, pollInterval };
