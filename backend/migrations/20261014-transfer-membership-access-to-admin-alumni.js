"use strict";

module.exports = {
    async up(queryInterface) {
        // Keep grant history and submitted applications. Only existing, verified
        // Admin Alumni personnel are designated; a revoked Alumni grant stays revoked.
        await queryInterface.sequelize.transaction(async transaction => {
            await queryInterface.sequelize.query(
                "UPDATE MembershipAdministrators m JOIN Users u ON u.id = m.user_id SET m.revoked_at = CURRENT_TIMESTAMP, m.updated_at = CURRENT_TIMESTAMP WHERE m.revoked_at IS NULL AND u.role = 'admin' AND u.admin_scope IN ('registrar', 'employer')",
                { transaction }
            );
            await queryInterface.sequelize.query(
                "INSERT INTO MembershipAdministrators (user_id, granted_by, grant_reason, created_at, updated_at) SELECT id, NULL, 'Admin Alumni read-only membership access designated by feature transfer', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM Users u WHERE u.role = 'admin' AND u.admin_scope = 'alumni' AND u.account_status = 'verified' AND NOT EXISTS (SELECT 1 FROM MembershipAdministrators m WHERE m.user_id = u.id)",
                { transaction }
            );
        });
    },
    async down() {
        throw new Error("Membership access must be reviewed explicitly. Automatic rollback must not restore access to former management roles.");
    }
};
