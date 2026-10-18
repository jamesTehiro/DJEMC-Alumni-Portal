// Compatibility entry point. The old runner targeted uppercase table names;
// use the canonical-table repair and its explicit database identity checks.
const db = require('../models');
require('./repairMessagingStorage').run(db)
    .catch(error => { console.error('Messaging schema repair failed:', error.original?.code || error.message); process.exitCode = 1; })
    .finally(() => db.sequelize.close());
