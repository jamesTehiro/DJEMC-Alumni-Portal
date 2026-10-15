"use strict";
module.exports = {
    async up(queryInterface) {
        // The user explicitly designated existing Registrar personnel to view submitted forms.
        // The membership API has no approval or editing operations for these grants.
        await queryInterface.sequelize.query("INSERT INTO MembershipAdministrators (user_id, granted_by, grant_reason, created_at, updated_at) SELECT id, NULL, 'Registrar read-only membership review designated by deployment', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM Users u WHERE u.role = 'admin' AND u.admin_scope = 'registrar' AND u.account_status = 'verified' AND NOT EXISTS (SELECT 1 FROM MembershipAdministrators m WHERE m.user_id = u.id)");
    },
    async down() { throw new Error("Review membership access before revoking a deployment grant. Automatic destructive rollback is disabled."); }
};
