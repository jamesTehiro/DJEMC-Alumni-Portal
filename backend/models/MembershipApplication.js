module.exports = (sequelize, DataTypes) => sequelize.define("MembershipApplication", {
    alumni_user_id: { type: DataTypes.INTEGER, allowNull: false, unique: true },
    personal_details: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
    educational_attainment: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
    work_experience: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
    training_seminars: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
    community_involvement: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
    awards_citations: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
    options: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
    applicant_name: { type: DataTypes.STRING(512), allowNull: false, defaultValue: "" },
    academic_program: { type: DataTypes.STRING, allowNull: true },
    graduation_year: { type: DataTypes.INTEGER, allowNull: true },
    consent_accepted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    consent_accepted_at: { type: DataTypes.DATE, allowNull: true },
    consent_text: { type: DataTypes.TEXT, allowNull: true },
    consent_version: { type: DataTypes.STRING(100), allowNull: true },
    application_status: { type: DataTypes.STRING(30), allowNull: false, defaultValue: "draft", validate: { isIn: [["draft", "submitted"]] } },
    submitted_at: { type: DataTypes.DATE, allowNull: true },
    profile_completed_at: { type: DataTypes.DATE, allowNull: true }
}, {
    tableName: "membershipapplications", createdAt: "created_at", updatedAt: "updated_at",
    indexes: [{ unique: true, fields: ["alumni_user_id"], name: "membership_application_alumni_uq" },
        { fields: ["application_status", "submitted_at"], name: "membership_application_status_date_idx" }]
});
