const test = require('node:test');
const assert = require('node:assert/strict');
const { Sequelize, DataTypes } = require('sequelize');
const db = require('../models');
const notifications = require('../controllers/notificationController');
const worker = require('../workers/emailQueueWorker');
test.after(() => db.sequelize.close());

test('real MySQL notification outbox, reservation ownership, rate-limit retry, permanent failure and crash hold', { skip: process.env.NOTIFICATION_DB_TEST !== '1' }, async () => {
    assert.ok(['localhost', '127.0.0.1', '::1'].includes(db.sequelize.config.host), 'Requires a local database.');
    const sql = new Sequelize(db.sequelize.config.database, db.sequelize.config.username, db.sequelize.config.password, {
        host: db.sequelize.config.host, port: db.sequelize.config.port, dialect: 'mysql', logging: false, pool: { max: 1, min: 1, idle: 60000 }
    });
    const original = { sequelize: db.sequelize, User: db.User, Notification: db.Notification, EmailQueueJob: db.EmailQueueJob };
    const envKeys = ['EMAIL_PROVIDER', 'BREVO_API_KEY', 'EMAIL_FROM', 'EMAIL_FROM_NAME'];
    const savedEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
    const originalFetch = global.fetch, tables = [];
    let status = 201, deliveries = 0;
    try {
        for (const name of ['User', 'Notification', 'EmailQueueJob']) {
            const model = name === 'User' ? sql.define('FixtureUser', { email: DataTypes.STRING }) : require(`../models/${name}`)(sql, DataTypes);
            const table = `notification_test_${process.pid}_${name.toLowerCase()}`;
            model.tableName = table; model.options.tableName = table;
            const generator = sql.getQueryInterface().queryGenerator;
            const ddl = generator.createTableQuery(table, generator.attributesToSQL(model.getAttributes(), { table }), { engine: 'InnoDB' }).replace(/^CREATE TABLE IF NOT EXISTS/, 'CREATE TEMPORARY TABLE');
            assert.match(ddl, /^CREATE TEMPORARY TABLE `notification_test_[a-z0-9_]+`/);
            await sql.query(ddl); tables.push(table); db[name] = model;
        }
        db.sequelize = sql;
        await sql.query(`ALTER TABLE \`${db.EmailQueueJob.tableName}\` ADD UNIQUE KEY notification_test_dedupe (dedupe_key)`);
        process.env.EMAIL_PROVIDER = 'brevo'; process.env.BREVO_API_KEY = 'fake-key';
        process.env.EMAIL_FROM = 'sender@example.invalid'; process.env.EMAIL_FROM_NAME = 'DJEMC Alumni Portal';
        global.fetch = async (url, options) => {
            assert.equal(url, 'https://api.brevo.com/v3/smtp/email');
            assert.equal(options.headers['api-key'], 'fake-key');
            const payload = JSON.parse(options.body);
            assert.ok(payload.to[0].email.endsWith('@example.invalid'));
            assert.equal(payload.subject, 'Existing subject'); assert.equal(payload.textContent, 'Existing message');
            deliveries++;
            return status === 201 ? Response.json({ messageId: '<fixture-message>' }, { status: 201 }) : new Response('private upstream details', { status, headers: { 'Retry-After': '120' } });
        };
        await db.User.bulkCreate([{ id: 1, email: 'first@example.invalid' }, { id: 2, email: 'second@example.invalid' }]);
        const create = ids => notifications.createNotification({ userIds: ids, type: 'warning', subject: 'Existing subject', message: 'Existing message' });
        assert.equal((await create([1, 2, 2])).length, 2);
        assert.equal(await db.Notification.count(), 2);
        assert.equal(await db.EmailQueueJob.count(), 2);
        const groups = await Promise.all([worker.reserveJobs(), worker.reserveJobs()]);
        const reserved = groups.flat();
        assert.equal(new Set(reserved.map(row => row.id)).size, 2);
        assert.equal(reserved.length, 2);
        for (const job of reserved) { assert.equal(job.attempts, 1); await worker.processJob(job); }
        assert.equal(await db.EmailQueueJob.count({ where: { status: 'sent' } }), 2);
        assert.equal(deliveries, 2);

        status = 429; await create([1]);
        const [limited] = await worker.reserveJobs(); const now = Date.now(); await worker.processJob(limited);
        await limited.reload();
        assert.equal(limited.status, 'pending'); assert.equal(limited.attempts, 1);
        assert.ok(limited.scheduled_at.getTime() >= now + 119000);
        assert.equal((await worker.reserveJobs()).length, 0);
        await limited.update({ scheduled_at: new Date(Date.now() - 1000) });
        status = 201; const [retry] = await worker.reserveJobs();
        assert.equal(retry.id, limited.id); assert.equal(retry.attempts, 2);
        await worker.processJob(retry);

        status = 401; await create([1]);
        const [permanent] = await worker.reserveJobs(); await worker.processJob(permanent); await permanent.reload();
        assert.equal(permanent.status, 'failed'); assert.equal(permanent.attempts, 1);
        assert.equal((await worker.reserveJobs()).length, 0);

        status = 201; await create([1]);
        const [accepted] = await worker.reserveJobs();
        const update = db.EmailQueueJob.update;
        db.EmailQueueJob.update = async (values, options) => {
            if (values.status === 'sent') throw new Error('Simulated database outage after provider acceptance');
            return update.call(db.EmailQueueJob, values, options);
        };
        try { await worker.processJob(accepted); } finally { db.EmailQueueJob.update = update; }
        await accepted.reload(); assert.equal(accepted.status, 'processing');
        const before = deliveries;
        await accepted.update({ processing_started_at: new Date(Date.now() - 3600000) });
        assert.equal((await worker.reserveJobs()).length, 0);
        await accepted.reload();
        assert.equal(accepted.status, 'failed'); assert.equal(JSON.parse(accepted.last_error).code, 'EMAIL_AMBIGUOUS');
        await worker.processJob(accepted); // Failed rows cannot pass the lease check.
        assert.equal(deliveries, before);

        const beforeNotifications = await db.Notification.count(), beforeJobs = await db.EmailQueueJob.count();
        const bulk = db.EmailQueueJob.bulkCreate;
        db.EmailQueueJob.bulkCreate = async (values, options) => sql.query('SELECT missing_notification_test_column', { transaction: options.transaction });
        try { assert.deepEqual(await create([1]), []); } finally { db.EmailQueueJob.bulkCreate = bulk; }
        assert.equal(await db.Notification.count(), beforeNotifications, 'Notification insert rolled back with failed enqueue.');
        assert.equal(await db.EmailQueueJob.count(), beforeJobs);
    } finally {
        global.fetch = originalFetch;
        envKeys.forEach(key => savedEnv[key] === undefined ? delete process.env[key] : process.env[key] = savedEnv[key]);
        Object.assign(db, original);
        for (const table of tables.reverse()) {
            assert.match(table, /^notification_test_[a-z0-9_]+$/);
            await sql.query(`DROP TEMPORARY TABLE IF EXISTS \`${table}\``);
        }
        await sql.close();
    }
});
