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

const verifyRegistrationOtpSchema = async db => {
    await db.User.findOne({ attributes: ["email_verified_at"], where: { id: -1 }, raw: true });
    await db.RegistrationEmailVerification.findOne({ where: { email_key: "__schema_probe__" }, raw: true });
    const indexes = await db.sequelize.getQueryInterface().showIndex("users");
    if (!indexes.some(index => index.unique && index.fields.length === 1 && index.fields[0].attribute === "normalized_email" && !index.fields[0].length)) {
        throw new Error("Registration email uniqueness is not ready. Apply the reviewed registration OTP migration before deploying this backend.");
    }
    const rateIndexes = await db.sequelize.getQueryInterface().showIndex("rate_limit_entries");
    if (!rateIndexes.some(index => index.unique && index.fields.length === 3 &&
        index.fields.every((field, i) => field.attribute === ["scope", "key", "window_start"][i] && !field.length))) {
        throw new Error("Shared rate-limit uniqueness is not ready. Apply the reviewed rate-limit schema before deploying registration OTP.");
    }
};

module.exports = { verifyAuthSchema, verifyRegistrationOtpSchema };
