module.exports = (sequelize, DataTypes) => sequelize.define("MembershipAdministrator", {
    user_id: { type: DataTypes.INTEGER, allowNull: false, unique: true },
    granted_by: { type: DataTypes.INTEGER, allowNull: true },
    grant_reason: { type: DataTypes.STRING(255), allowNull: false },
    revoked_at: { type: DataTypes.DATE, allowNull: true }
}, { tableName: "membershipadministrators", createdAt: "created_at", updatedAt: "updated_at" });
