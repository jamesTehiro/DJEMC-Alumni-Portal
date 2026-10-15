"use strict";

const hasTable = async (qi, name) => (await qi.showAllTables()).some(table => String(table).toLowerCase() === name.toLowerCase());
const timestamps = Sequelize => ({
    created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP") }
});
const userReference = Sequelize => ({ type: Sequelize.INTEGER, allowNull: false, references: { model: "Users", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" });
const ensureUnique = async (qi, table, field, name) => {
    const indexes = await qi.showIndex(table);
    if (indexes.some(index => index.unique && index.fields.length === 1 && index.fields[0].attribute === field)) return;
    if (indexes.some(index => index.name === name)) throw new Error(`${table}.${name} exists without the required unique constraint. Review that index before retrying this migration.`);
    await qi.addIndex(table, [field], { name, unique: true });
};

module.exports = {
    async up(qi, Sequelize) {
        if (!await hasTable(qi, "MembershipApplications")) {
            const json = { type: Sequelize.JSON, allowNull: false };
            await qi.createTable("MembershipApplications", {
                id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
                alumni_user_id: { ...userReference(Sequelize) },
                personal_details: { ...json }, educational_attainment: { ...json }, work_experience: { ...json },
                training_seminars: { ...json }, community_involvement: { ...json }, awards_citations: { ...json }, options: { ...json },
                applicant_name: { type: Sequelize.STRING(512), allowNull: false, defaultValue: "" },
                academic_program: { type: Sequelize.STRING, allowNull: true }, graduation_year: { type: Sequelize.INTEGER, allowNull: true },
                consent_accepted: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
                consent_accepted_at: { type: Sequelize.DATE, allowNull: true }, consent_text: { type: Sequelize.TEXT, allowNull: true },
                consent_version: { type: Sequelize.STRING(100), allowNull: true },
                application_status: { type: Sequelize.STRING(30), allowNull: false, defaultValue: "draft" },
                submitted_at: { type: Sequelize.DATE, allowNull: true }, profile_completed_at: { type: Sequelize.DATE, allowNull: true },
                ...timestamps(Sequelize)
            });
        }
        await ensureUnique(qi, "MembershipApplications", "alumni_user_id", "membership_application_alumni_uq");
        const indexes = await qi.showIndex("MembershipApplications");
        if (!indexes.some(index => index.name === "membership_application_status_date_idx")) {
            await qi.addIndex("MembershipApplications", ["application_status", "submitted_at"], { name: "membership_application_status_date_idx" });
        }
        if (!await hasTable(qi, "MembershipAdministrators")) {
            await qi.createTable("MembershipAdministrators", {
                id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
                user_id: { ...userReference(Sequelize) },
                granted_by: { type: Sequelize.INTEGER, allowNull: true, references: { model: "Users", key: "id" }, onUpdate: "CASCADE", onDelete: "SET NULL" },
                grant_reason: { type: Sequelize.STRING(255), allowNull: false }, revoked_at: { type: Sequelize.DATE, allowNull: true },
                ...timestamps(Sequelize)
            });
        }
        await ensureUnique(qi, "MembershipAdministrators", "user_id", "membership_administrator_user_uq");
        // The task designates the existing verified Employer Admin as the membership manager.
        // This is an explicit, persistent grant; future accounts receive no automatic permission.
        await qi.sequelize.query("INSERT INTO MembershipAdministrators (user_id, granted_by, grant_reason, created_at, updated_at) SELECT id, NULL, 'Initial verified Employer Admin designated by membership deployment', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM Users u WHERE u.role = 'admin' AND u.admin_scope = 'employer' AND u.account_status = 'verified' AND NOT EXISTS (SELECT 1 FROM MembershipAdministrators m WHERE m.user_id = u.id)");
    },
    async down() {
        throw new Error("Membership records must be preserved. Automatic destructive rollback is disabled; restore from a reviewed backup instead.");
    }
};
