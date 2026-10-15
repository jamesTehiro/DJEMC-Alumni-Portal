const db = require("../models");
const { verifyAuthSchema } = require("../utils/databaseReadiness");

const getSafeDatabaseError = (err) => ({
    name: err?.name || "Error",
    code: err?.original?.code || err?.parent?.code || err?.code || null
});

exports.getHealth = async (_req, res) => {
    try {
        await db.sequelize.authenticate();
        await verifyAuthSchema(db);
        return res.status(200).json({ status: "ok", database: "connected", authSchema: "available", registrationSchema: "available" });
    } catch (err) {
        console.error("[database-health] Database check failed", getSafeDatabaseError(err));
        return res.status(503).json({ status: "error", database: "unavailable" });
    }
};
