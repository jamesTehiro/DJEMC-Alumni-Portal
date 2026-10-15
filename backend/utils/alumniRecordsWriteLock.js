const db = require("../models");

// Both CSV import and manual creation lock the same existing registrar row.
// It serializes duplicate checks and inserts without changing record schemas.
module.exports = async (transaction) => {
    const registrar = await db.User.findOne({
        where: { role: "admin", admin_scope: "registrar" },
        attributes: ["id"],
        order: [["id", "ASC"]],
        transaction,
        lock: transaction.LOCK.UPDATE
    });
    if (!registrar) throw Object.assign(new Error("A registered registrar account is required to add alumni records."), { status: 403 });
};
