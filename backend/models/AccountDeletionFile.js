module.exports = (sequelize, DataTypes) => sequelize.define('AccountDeletionFile', {
    reference: { type: DataTypes.TEXT, allowNull: false },
    status: { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'pending' },
    attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    next_attempt_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    last_error: { type: DataTypes.STRING(80), allowNull: true }
}, { tableName: "account_deletion_files", indexes: [{ name: 'account_deletion_files_due', fields: ['status', 'next_attempt_at'] }] });
