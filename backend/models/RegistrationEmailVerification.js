module.exports = (sequelize, DataTypes) => sequelize.define("RegistrationEmailVerification", {
    email_key: { type: DataTypes.STRING(254), primaryKey: true },
    email: { type: DataTypes.STRING(254), allowNull: false },
    session_hash: { type: DataTypes.STRING(64), allowNull: false },
    otp_hash: { type: DataTypes.STRING(64), allowNull: true },
    status: { type: DataTypes.STRING(16), allowNull: false },
    expires_at: DataTypes.DATE(3),
    verified_at: DataTypes.DATE,
    consumed_at: DataTypes.DATE,
    consumed_by_user_id: DataTypes.INTEGER,
    sent_at: { type: DataTypes.DATE(3), allowNull: false },
    resend_history: { type: DataTypes.JSON, allowNull: false },
    failed_attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 }
}, { tableName: "registration_email_verifications", indexes: [{ fields: ["session_hash"], unique: true }] });
