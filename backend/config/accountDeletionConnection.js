const fs = require('node:fs');
const path = require('node:path');
// Scope certificate verification to the deletion migration/worker. No credentials
// or provider references are logged and no connection is opened by this helper.
function secureConnection(sequelize, env = process.env) {
    if (/^(localhost|127\.0\.0\.1|::1)$/i.test(sequelize.config.host)) return;
    const ca = fs.readFileSync(env.MIGRATION_DB_CA_FILE || env.DB_CA_FILE || path.join(__dirname, '../cert/ca.pem'), 'utf8');
    const ssl = { ca, rejectUnauthorized: true, verifyIdentity: true, minVersion: 'TLSv1.2' };
    for (const settings of [sequelize.config, sequelize.options]) settings.dialectOptions = { ...settings.dialectOptions, ssl };
}
module.exports = { secureConnection };
