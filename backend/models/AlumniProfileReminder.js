module.exports = (sequelize, DataTypes) => sequelize.define("AlumniProfileReminder", {
    user_id: { type: DataTypes.INTEGER, primaryKey: true, allowNull: false },
    next_reminder_at: { type: DataTypes.DATE(3), allowNull: false },
    last_reminded_at: { type: DataTypes.DATE(3), allowNull: true },
    last_profile_updated_at: { type: DataTypes.DATE(3), allowNull: true }
}, { tableName: "alumni_profile_reminders", timestamps: false });
