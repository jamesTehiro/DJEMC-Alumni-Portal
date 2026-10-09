const db = require("../models");

let lastCleanupAt = 0;

const cleanupExpiredEntries = async () => {
    const now = Date.now();
    if (now - lastCleanupAt < 5 * 60 * 1000) return;
    lastCleanupAt = now;

    await db.RateLimitEntry.destroy({
        where: {
            expires_at: {
                [db.Sequelize.Op.lt]: new Date(now)
            }
        }
    });
};

const consumeRateLimit = async ({ scope, key, windowMs, maxRequests }) => {
    const now = Date.now();
    const windowStartMs = now - (now % windowMs);
    const windowStart = new Date(windowStartMs);
    const expiresAt = new Date(windowStartMs + windowMs);
    const tableName = db.RateLimitEntry.getTableName();

    await db.sequelize.query(
        `INSERT INTO ${tableName} (scope, \`key\`, window_start, count, expires_at, createdAt)
         VALUES (?, ?, ?, 1, ?, NOW())
         ON DUPLICATE KEY UPDATE count = count + 1, expires_at = VALUES(expires_at)`,
        {
            replacements: [scope, key, windowStart, expiresAt]
        }
    );

    const [rows] = await db.sequelize.query(
        `SELECT count, expires_at FROM ${tableName}
         WHERE scope = ? AND \`key\` = ? AND window_start = ?
         LIMIT 1`,
        {
            replacements: [scope, key, windowStart]
        }
    );

    await cleanupExpiredEntries();

    const entry = rows[0];
    return {
        allowed: entry.count <= maxRequests,
        remaining: Math.max(0, maxRequests - entry.count),
        resetAt: new Date(entry.expires_at).getTime()
    };
};

module.exports = {
    consumeRateLimit
};
