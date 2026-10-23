const test = require('node:test');
const assert = require('node:assert/strict');
process.env.OBJECT_STORAGE_PROVIDER = 'cloudinary';
process.env.CLOUDINARY_CLOUD_NAME = 'messaging-fixture';
process.env.CLOUDINARY_API_KEY = 'fixture-key';
process.env.CLOUDINARY_API_SECRET = 'fixture-secret';
process.env.JWT_SECRET = 'messaging-test-secret';
const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../models');
const employer = require('../controllers/adminEmployerMessageController');
const originals = [], rows = [], legacyRows = [], requests = [];
const users = [null, { id: 1, role: 'alumni', account_status: 'verified' }, { id: 2, role: 'employer' },
    { id: 3, role: 'admin', admin_scope: 'alumni' }, { id: 4, role: 'admin', admin_scope: 'employer' },
    { id: 5, role: 'alumni', account_status: 'verified' }, { id: 6, role: 'admin', admin_scope: 'registrar' }];
const stub = (target, key, value) => { originals.push([target, key, target[key]]); target[key] = value; };
const conversation = { id: 9, type: 'direct', update: async () => {} };
const forum = { id: 1, type: 'forum', update: async () => {} };
const legacyConversation = { id: 7, employerId: 2, adminId: 4, update: async () => {} };
const bytes = Buffer.from('%PDF-1.7\nMessaging fixture');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const assets = new Map();
let server, origin, databaseFailure = false, providerFailure = false, cloudReads = 0;
const originalFetch = global.fetch;
const savedRow = (data, collection) => {
    const row = { ...data, id: collection.length + 1, createdAt: new Date(), toJSON() { return { ...this, toJSON: undefined }; } };
    collection.push(row); return row;
};
test.before(async () => {
    stub(db.User, 'findByPk', async id => users[Number(id)]);
    stub(db.Conversation, 'findByPk', async id => Number(id) === 9 ? conversation : Number(id) === 1 ? forum : null);
    stub(db.ConversationParticipant, 'findOne', async ({ where }) => [1, 2, 3, 4].includes(Number(where.user_id)) ? {} : null);
    stub(db.ConversationParticipant, 'findOrCreate', async () => [{}]);
    stub(db.sequelize, 'transaction', async run => run({ LOCK: { UPDATE: 'UPDATE' } }));
    stub(db.Message, 'create', async data => {
        if (databaseFailure) throw Object.assign(new Error('SQL fixture-secret message contents'), { original: { code: 'ER_BAD_FIELD_ERROR' } });
        return savedRow(data, rows);
    });
    stub(db.Message, 'findByPk', async id => rows.find(row => row.id === Number(id)) || null);
    stub(db.Message, 'findAll', async ({ where }) => rows.filter(row => row.conversation_id === where.conversation_id).reverse());
    stub(db.EmployerConversation, 'findByPk', async id => Number(id) === 7 ? legacyConversation : null);
    stub(employer, 'ensureEmployerConversation', async id => {
        assert.equal(Number(id), 2); return legacyConversation;
    });
    stub(db.EmployerMessage, 'create', async data => savedRow(data, legacyRows));
    stub(db.EmployerMessage, 'findByPk', async id => {
        const row = legacyRows.find(row => row.id === Number(id));
        return row ? Object.assign(row, { conversation: legacyConversation }) : null;
    });
    stub(db.EmployerMessage, 'findAll', async () => legacyRows);
    stub(db.MessageSendRequest, 'findOne', async ({ where }) => requests.find(row => Object.keys(where).every(key => row[key] === where[key])) || null);
    stub(db.MessageSendRequest, 'create', async data => { requests.push(data); return data; });
    global.fetch = async (url, options) => {
        if (!String(url).includes('cloudinary.com')) return originalFetch(url, options);
        if (providerFailure) return new Response('secret provider body and URL', { status: 400, headers: { 'x-cld-error': 'Invalid transformation secret-reference' } });
        if (String(url).endsWith('/upload')) {
            assert.equal(options.body.get('type'), 'authenticated');
            const file = options.body.get('file');
            const image = file.type === 'image/png';
            const content = Buffer.from(await file.arrayBuffer());
            assert.deepEqual(content, image ? png : bytes);
            const publicId = `private_uploads/chat/fixture.${image ? 'png' : 'pdf'}`;
            assets.set(publicId, { content, mime: file.type });
            return Response.json({ resource_type: image ? 'image' : 'raw', type: 'authenticated', public_id: publicId, secure_url: `https://res.cloudinary.com/messaging-fixture/${image ? 'image' : 'raw'}/authenticated/v123/${publicId}${image ? '.png' : ''}` });
        }
        cloudReads++;
        const target = new URL(url);
        let publicId;
        if (target.hostname === 'api.cloudinary.com') {
            assert.equal(target.pathname, '/v1_1/messaging-fixture/raw/download');
            assert.equal(target.searchParams.get('type'), 'authenticated');
            assert.equal(target.searchParams.get('format'), 'pdf');
            publicId = target.searchParams.get('public_id');
        } else {
            assert.match(target.pathname, /\/image\/authenticated\/s--[^/]+--\/v123\/private_uploads\/chat\/fixture.png.png$/);
            publicId = 'private_uploads/chat/fixture.png';
        }
        const asset = assets.get(publicId);
        assert.ok(asset);
        return new Response(asset.content, { headers: { 'Content-Type': asset.mime } });
    };
    const app = express(); app.use(express.json());
    app.use('/api/messages', require('../routes/messageRoutes'));
    app.use('/api/admin-employer', require('../routes/adminEmployerMessageRoutes'));
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
    global.fetch = originalFetch;
    for (const [target, key, value] of originals.reverse()) target[key] = value;
    if (server) await new Promise(resolve => server.close(resolve));
    await db.sequelize.close();
});
const headers = id => id ? { Authorization: `Bearer ${jwt.sign(users[id], process.env.JWT_SECRET)}` } : {};
const send = (id, legacy, attachment, key) => {
    const form = new FormData();
    form.append(legacy ? 'message' : 'message_text', 'Fixture text');
    form.append('client_message_id', key);
    if (legacy) form.append('employerId', '2');
    if (attachment) form.append('attachment', new Blob([attachment === 'png' ? png : bytes], { type: attachment === 'png' ? 'image/png' : 'application/pdf' }), attachment === 'png' ? 'fixture.png' : 'fixture.pdf');
    return fetch(origin + (legacy ? '/api/admin-employer/messages' : '/api/messages/9'), { method: 'POST', headers: headers(id), body: form });
};

test('all four roles send text and multipart attachments, replay retries, and read persisted history', async () => {
    for (const id of [1, 2, 3, 4]) {
        for (const legacy of id === 2 || id === 4 ? [false, true] : [false]) {
            for (const attachment of [false, 'pdf', 'png']) {
                const key = `role-${id}-${legacy}-${attachment}-request`;
                const first = await send(id, legacy, attachment, key);
                assert.equal(first.status, 201, await first.clone().text());
                assert.equal(first.headers.get('cache-control'), 'private, no-store');
                const body = await first.json(), message = legacy ? body.message : body;
                const retry = await send(id, legacy, attachment, key);
                assert.equal(retry.status, 201);
                const repeated = await retry.json();
                assert.equal((legacy ? repeated.message : repeated).id, message.id);
                const path = legacy ? '/api/admin-employer/messages/2' : '/api/messages/9';
                const history = await fetch(origin + path, { headers: headers(id) });
                assert.equal(history.status, 200);
                const record = (await history.json()).messages.find(row => row.id === message.id);
                assert.ok(record);
                const reference = legacy ? record.attachment : record.file_url;
                assert.equal(Boolean(reference), Boolean(attachment));
                if (attachment) {
                    assert.equal(record.file_mime, attachment === 'png' ? 'image/png' : 'application/pdf');
                    for (const conditional of [false, true, 'download']) {
                        const response = await fetch(origin + reference + (conditional === 'download' ? '?download=1' : ''), { headers: { ...headers(id), ...(conditional === true ? { 'If-None-Match': '"stale-fixture"' } : {}) } });
                        assert.equal(response.status, 200);
                        assert.equal(response.headers.get('cache-control'), 'private, no-store');
                        assert.match(response.headers.get('content-type'), attachment === 'png' ? /^image\/png/ : /^application\/pdf/);
                        assert.deepEqual(Buffer.from(await response.arrayBuffer()), attachment === 'png' ? png : bytes);
                        assert.match(response.headers.get('content-disposition'), conditional === 'download' ? /^attachment;/ : /^inline;/);
                    }
                }
            }
        }
    }
    assert.equal(rows.length, 12);
    assert.equal(legacyRows.length, 6);
});

test('authentication, role scope and conversation ownership reject requests before storage access', async () => {
    const before = cloudReads;
    for (const [id, path, status] of [[null, '/api/messages/9', 401], [5, '/api/messages/9', 403], [5, '/api/messages/files/2', 403], [2, '/api/messages/1', 403], [3, '/api/admin-employer/messages/2', 403], [6, '/api/admin-employer/messages/2', 403], [2, '/api/admin-employer/messages/99', 403]]) {
        const response = await fetch(origin + path, { headers: headers(id) });
        assert.equal(response.status, status, path);
        assert.equal(response.headers.get('cache-control'), 'private, no-store');
    }
    assert.equal(cloudReads, before);
    assert.equal((await fetch(origin + '/api/messages/files/999', { headers: headers(1) })).status, 404);
});

test('database errors and upstream Cloudinary 400 produce safe 503/502 responses and sanitized diagnostics', async () => {
    const output = [], originalError = console.error;
    console.error = (...args) => output.push(JSON.stringify(args));
    try {
        databaseFailure = true;
        const failed = await send(1, false, false, 'database-failure-request');
        assert.equal(failed.status, 503);
        assert.match((await failed.json()).msg, /schema update/);
        databaseFailure = false;
        providerFailure = true;
        const unavailable = await fetch(origin + '/api/messages/files/2', { headers: headers(1) });
        assert.equal(unavailable.status, 502);
        assert.match(unavailable.headers.get('content-type'), /application\/json/);
        assert.equal(unavailable.headers.get('content-disposition'), null);
        assert.match((await unavailable.json()).msg, /temporarily unavailable/);
        assert.match(output.join(''), /ER_BAD_FIELD_ERROR/);
        assert.match(output.join(''), /invalid_transformation/);
        assert.doesNotMatch(output.join(''), /fixture-secret|secret provider|secret-reference|SQL fixture|Bearer|https:/);
    } finally { databaseFailure = false; providerFailure = false; console.error = originalError; }
});
