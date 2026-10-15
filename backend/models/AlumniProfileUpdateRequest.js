module.exports = (sequelize, DataTypes) => sequelize.define("AlumniProfileUpdateRequest", {
    alumni_user_id: { type: DataTypes.INTEGER, allowNull: false },
    requested_by: { type: DataTypes.INTEGER, allowNull: false },
    notification_id: { type: DataTypes.INTEGER, allowNull: true },
    email_queue_job_id: { type: DataTypes.INTEGER, allowNull: true },
    status: { type: DataTypes.STRING(30), allowNull: false, defaultValue: "pending" },
    request_message: { type: DataTypes.TEXT, allowNull: false },
    sent_at: { type: DataTypes.DATE, allowNull: true },
    responded_at: { type: DataTypes.DATE, allowNull: true },
    completed_at: { type: DataTypes.DATE, allowNull: true }
}, {
    tableName: "AlumniProfileUpdateRequests",
    indexes: [
        { fields: ["alumni_user_id", "status"], name: "alumni_profile_update_requests_user_status_idx" },
        { fields: ["requested_by", "createdAt"], name: "alumni_profile_update_requests_actor_created_idx" },
        { unique: true, fields: ["notification_id"], name: "alumni_profile_update_requests_notification_uq" },
        { unique: true, fields: ["email_queue_job_id"], name: "alumni_profile_update_requests_email_job_uq" }
    ]
});
