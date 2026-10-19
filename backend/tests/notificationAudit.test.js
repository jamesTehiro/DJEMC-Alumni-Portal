const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../models');
const { inspectSchema } = require('../scripts/auditNotificationConfig');
test.after(() => db.sequelize.close());

test('schema audit is read-only and rejects case, column, type, index and transactional-engine gaps', async () => {
    for (const defect of [null, 'case', 'column', 'type', 'index', 'prefix', 'nullable', 'engine']) {
        const generator = db.sequelize.dialect.queryGenerator;
        const descriptions = Object.fromEntries([db.Notification, db.EmailQueueJob].map(model => [model.getTableName(), Object.fromEntries(Object.values(model.rawAttributes).map(attribute => [attribute.field, { type: attribute.type.toSql({ escape: generator.escape.bind(generator) }) }]))]));
        descriptions.email_queue_jobs.dedupe_key.allowNull = defect !== 'nullable';
        if (defect === 'column') delete descriptions.email_queue_jobs.max_attempts;
        if (defect === 'type') descriptions.email_queue_jobs.message.type = 'VARCHAR(255)';
        const qi = {
            showAllTables: async () => defect === 'case' ? ['Notifications', 'email_queue_jobs'] : ['notifications', 'email_queue_jobs'],
            describeTable: async table => descriptions[table],
            showIndex: async () => defect === 'index' ? [] : [{ unique: true, fields: [{ attribute: 'dedupe_key', ...(defect === 'prefix' ? { length: 32 } : {}) }] }]
        };
        const fake = { Notification: db.Notification, EmailQueueJob: db.EmailQueueJob, sequelize: {
            getQueryInterface: () => qi, dialect: { supports: { skipLocked: false } },
            query: async sql => {
                assert.match(sql, /^SELECT /);
                return [[{ table_name: 'notifications', engine: 'InnoDB' }, { table_name: 'email_queue_jobs', engine: defect === 'engine' ? 'MyISAM' : 'InnoDB' }]];
            }
        } };
        const result = await inspectSchema(fake);
        assert.equal(result.ready, !defect, String(defect));
        assert.equal(result.skipLockedSupportedByDialect, false);
        assert.doesNotMatch(JSON.stringify(result), /recipient|password|api-key/);
    }
});
