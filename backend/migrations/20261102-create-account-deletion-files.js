'use strict';
const { TABLE, INDEX, fields, inspect } = require('../services/accountDeletionSchema');
// Additive, explicitly invoked only. Does not alter any existing foreign keys.
module.exports = {
    async up(qi, Sequelize) {
        const before = await inspect(qi);
        if (before.exists && before.issues.some(issue => issue !== 'cleanup_due_index_missing')) throw new Error('Existing cleanup schema is incompatible. Review before migration.');
        if (!before.exists) await qi.createTable(TABLE, {
            id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
            reference: { type: Sequelize.TEXT, allowNull: false },
            status: { type: Sequelize.STRING(24), allowNull: false, defaultValue: 'pending' },
            attempts: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
            next_attempt_at: { type: Sequelize.DATE, allowNull: false },
            last_error: { type: Sequelize.STRING(80), allowNull: true },
            createdAt: { type: Sequelize.DATE, allowNull: false },
            updatedAt: { type: Sequelize.DATE, allowNull: false }
        }, { engine: 'InnoDB' });
        const afterCreate = await inspect(qi);
        if (afterCreate.issues.some(issue => issue !== 'cleanup_due_index_missing')) throw new Error('Created cleanup schema is incompatible. Review before continuing.');
        if (!afterCreate.ready) await qi.addIndex(TABLE, fields, { name: INDEX });
        if (!(await inspect(qi)).ready) throw new Error('Cleanup schema verification failed.');
    },
    inspect,
    async down() { throw new Error('Cleanup records must be retained. Automatic destructive rollback is disabled.'); }
};
