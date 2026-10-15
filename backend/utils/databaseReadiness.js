const verifyAuthSchema = async (db) => {
    // Impossible IDs make these SELECTs validate table/column mappings without reading records.
    await Promise.all([
        db.User.findOne({
            attributes: ["id", "email", "password", "role", "account_status"],
            where: { id: -1 },
            raw: true
        }),
        db.AlumniProfile.findOne({
            attributes: ["id", "user_id"],
            where: { user_id: -1 },
            raw: true
        }),
        db.EmployerProfile.findOne({
            attributes: ["id", "user_id"],
            where: { user_id: -1 },
            raw: true
        })
    ]);
};

module.exports = { verifyAuthSchema };
