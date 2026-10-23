const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const zlib = require('node:zlib');
process.env.OBJECT_STORAGE_PROVIDER = 'cloudinary';
process.env.CLOUDINARY_CLOUD_NAME = 'application-verification';
process.env.CLOUDINARY_API_KEY = 'fixture-key';
process.env.CLOUDINARY_API_SECRET = 'fixture-secret';
process.env.JWT_SECRET = 'application-verification-secret';
process.env.MAX_UPLOAD_MB = '1';
const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../models');
const storage = require('../services/objectStorage');
const audit = require('../services/auditService');
const middleware = require('../middleware/uploadMiddleware');
const originalFetch = global.fetch;
const pdf = Buffer.from('%PDF-1.7\napplication verification fixture\n%%EOF');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const assets = new Map();
const originals = [];
const replace = (object, key, value) => { const previous = object[key]; originals.push(() => { object[key] = previous; }); object[key] = value; };
let server, base, uploaded, providerCalls = 0, providerFailure = 0, application;
const auth = user => ({ Authorization: `Bearer ${jwt.sign(user, process.env.JWT_SECRET)}` });
const owner = { id: 9, role: 'employer' };

test.before(async () => {
    replace(global, 'fetch', async (url, options) => {
        if (new URL(url).hostname === '127.0.0.1') return originalFetch(url, options);
        assert.ok(['api.cloudinary.com', 'res.cloudinary.com'].includes(new URL(url).hostname));
        providerCalls++;
        if (String(url).endsWith('/destroy')) {
            assets.delete(new URLSearchParams(options.body).get('public_id'));
            return Response.json({ result: 'ok' });
        }
        if (String(url).endsWith('/upload')) {
            const form = options.body, file = form.get('file'), publicId = form.get('public_id');
            const resourceType = file.type.startsWith('image/') ? 'image' : 'raw';
            const type = form.get('type');
            const item = { public_id: publicId, resource_type: resourceType, type, secure_url: `https://res.cloudinary.com/application-verification/${resourceType}/${type}/v1/${publicId}${resourceType === 'image' ? '.png' : ''}` };
            assets.set(publicId, { bytes: Buffer.from(await file.arrayBuffer()), mime: file.type, item });
            return Response.json(item);
        }
        if (providerFailure) return new Response('private provider response must not be served as a document', { status: providerFailure });
        const parsed = new URL(url);
        const id = parsed.searchParams.get('public_id');
        const asset = id ? assets.get(id) : [...assets.values()].find(asset => parsed.pathname.endsWith(asset.item.public_id) || parsed.pathname.endsWith(asset.item.public_id + '.png'));
        return asset ? new Response(asset.bytes, { headers: { 'Content-Type': asset.mime } }) : new Response('missing', { status: 404 });
    });
    replace(db.User, 'findByPk', async id => ({
        9: { id: 9, role: 'employer', admin_scope: null, account_status: 'verified' },
        5: { id: 5, role: 'admin', admin_scope: 'employer', account_status: 'verified' },
        6: { id: 6, role: 'admin', admin_scope: 'registrar', account_status: 'verified' },
        8: { id: 8, role: 'admin', admin_scope: 'alumni', account_status: 'verified' },
        7: { id: 7, role: 'alumni', admin_scope: null, account_status: 'verified' },
        99: { id: 99, role: 'employer', admin_scope: null, account_status: 'verified' }
    })[id] || null);
    replace(db.Application, 'findByPk', async () => application);
    replace(db.ApplicationDocument, 'findOne', async ({ where }) => application.ApplicationDocuments.find(doc => String(doc.id) === String(where.id) && doc.application_id === where.application_id) || null);
    replace(audit, 'log', async () => {});
    const app = express();
    app.post('/upload', middleware.applicationUpload, (req, res) => { uploaded = req.files; res.json({ fields: Object.keys(req.files) }); });
    // Also exercise the local storage branch without changing process-wide configuration.
    const enabled = storage.isObjectStorageEnabled, modulePath = require.resolve('../middleware/uploadMiddleware'), cached = require.cache[modulePath];
    storage.isObjectStorageEnabled = () => false;
    delete require.cache[modulePath];
    const localMiddleware = require('../middleware/uploadMiddleware');
    storage.isObjectStorageEnabled = enabled;
    require.cache[modulePath] = cached;
    app.post('/local-upload', localMiddleware.applicationUpload, async (req, res) => {
        const files = Object.values(req.files).flat();
        const results = await Promise.all(files.map(async file => { const bytes = await fs.readFile(file.path); await fs.unlink(file.path); return bytes.toString('base64'); }));
        res.json(results);
    });
    app.use('/api/applications', require('../routes/applicationRoutes'));
    app.use(require('../middleware/errorHandler'));
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { for (const restore of originals.reverse()) restore(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await db.sequelize.close(); });

test('applicant uploads reject forged bytes, mismatched MIME/extensions, oversize and count in cloud and local storage', async () => {
    for (const route of ['/upload', '/local-upload']) {
        for (const [name, mime, bytes] of [['fake.pdf', 'application/pdf', Buffer.from('<html>not a PDF</html>')], ['fake.png', 'image/png', pdf], ['fake.pdf', 'text/html', pdf], ['fake.exe', 'application/pdf', pdf]]) {
            const before = providerCalls;
            const form = new FormData(); form.append('requirement_resume', new Blob([bytes], { type: mime }), name);
            const response = await fetch(base + route, { method: 'POST', body: form });
            assert.equal(response.status, 415, `${route} ${name} ${mime}`);
            assert.equal(providerCalls, before);
        }
        const oversized = new FormData(); oversized.append('resume', new Blob([Buffer.alloc(1024 * 1024 + 1)], { type: 'application/pdf' }), 'large.pdf');
        assert.equal((await fetch(base + route, { method: 'POST', body: oversized })).status, 413);
        const many = new FormData(); for (let i = 0; i < 21; i++) many.append(`requirement_${i}`, new Blob([pdf], { type: 'application/pdf' }), `${i}.pdf`);
        assert.equal((await fetch(base + route, { method: 'POST', body: many })).status, 413);
    }
});

test('new applicant PDF/image uploads are authenticated and the real document/resume routes preserve bytes and authorization', async () => {
    const form = new FormData();
    form.append('resume', new Blob([pdf], { type: 'application/pdf' }), 'Resume.pdf');
    form.append('requirement_id', new Blob([png], { type: 'image/png' }), 'ID.png');
    assert.equal((await fetch(base + '/upload', { method: 'POST', body: form })).status, 200);
    application = { id: 31, alumni_id: 7, Job: { id: 45, employer_id: 9 }, resume_path: uploaded.resume[0].path, ApplicationDocuments: [] };
    for (const [index, file] of Object.values(uploaded).flat().entries()) {
        assert.equal(storage.parseStoredFileReference(file.path).type, 'authenticated');
        application.ApplicationDocuments.push({ id: index + 1, application_id: 31, file_path: file.path, mime_type: file.mimetype, file_name: file.originalname, requirement_code: index ? 'id' : 'resume' });
    }
    for (const [route, bytes] of [['documents/1/file', pdf], ['documents/2/file', png], ['resume/file', pdf]]) {
        for (const user of [owner, { id: 5, role: 'admin', admin_scope: 'employer' }, { id: 7, role: 'alumni' }]) {
            for (const suffix of ['', '?download=1']) {
                const response = await fetch(`${base}/api/applications/31/${route}${suffix}`, { headers: auth(user) });
                assert.equal(response.status, 200);
                assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
                assert.equal(response.headers.get('cache-control'), 'private, no-store');
                if (suffix) assert.match(response.headers.get('content-disposition') || '', /^attachment;/);
            }
        }
        for (const user of [{ id: 99, role: 'employer' }, { id: 99, role: 'alumni' }, { id: 6, role: 'admin', admin_scope: 'employer' }]) {
            const before = providerCalls;
            assert.equal((await fetch(`${base}/api/applications/31/${route}`, { headers: auth(user) })).status, 403);
            assert.equal(providerCalls, before);
        }
        assert.equal((await fetch(`${base}/api/applications/31/${route}`)).status, 401);
    }
    assert.equal((await fetch(`${base}/api/applications/31/documents/999/file`, { headers: auth(owner) })).status, 404);
});

// Read central-directory entries so ZIP integrity checks compare actual extracted bytes.
function unzip(bytes) {
    const result = new Map(); let offset = 0;
    while ((offset = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), offset)) !== -1) {
        const method = bytes.readUInt16LE(offset + 10), size = bytes.readUInt32LE(offset + 20), nameLength = bytes.readUInt16LE(offset + 28), localOffset = bytes.readUInt32LE(offset + 42);
        const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString();
        const start = localOffset + 30 + bytes.readUInt16LE(localOffset + 26) + bytes.readUInt16LE(localOffset + 28);
        const content = bytes.subarray(start, start + size);
        result.set(name, method === 8 ? zlib.inflateRawSync(content) : content); offset += 46 + nameLength;
    }
    return result;
}

test('bulk applicant ZIP includes Cloudinary PDF/image originals and restricts admin scope', async () => {
    assert.ok(application);
    for (const user of [{ id: 6, role: 'admin', admin_scope: 'employer' }, { id: 8, role: 'admin', admin_scope: 'employer' }, { id: 99, role: 'employer' }]) {
        const before = providerCalls;
        assert.equal((await fetch(`${base}/api/applications/31/documents/download`, { headers: auth(user) })).status, 403);
        assert.equal(providerCalls, before);
    }
    const response = await fetch(`${base}/api/applications/31/documents/download`, { headers: auth(owner) });
    assert.equal(response.status, 200, await response.clone().text());
    assert.match(response.headers.get('content-type'), /application\/zip/);
    const contents = unzip(Buffer.from(await response.arrayBuffer()));
    assert.deepEqual(contents.get('resume_Resume.pdf'), pdf);
    assert.deepEqual(contents.get('id_ID.png'), png);
});

test('generic secure application tokens enforce the same employer admin scope', async () => {
    const files = require('../controllers/fileController');
    const reference = application?.resume_path || `cld:${Buffer.from(JSON.stringify({provider:'cloudinary',resourceType:'raw',type:'upload',publicId:'resume.pdf',url:'https://res.cloudinary.com/application-verification/raw/upload/v1/resume.pdf'})).toString('base64url')}`;
    replace(db.Application, 'findOne', async () => ({ alumni_id: 7, Job: { employer_id: 9 } }));
    replace(db.EmployerProfile, 'findOne', async () => null); replace(db.EmployerProfile, 'findAll', async () => []); replace(db.AlumniProfile, 'findOne', async () => null);
    for (const scope of ['registrar', 'alumni', undefined]) {
        const res = { code: 200, setHeader() {}, send() {}, status(code) { this.code = code; return this; }, json() {} };
        await files.getSecureStoredFile({ params: { token: Buffer.from(reference).toString('base64url') }, user: { id: 5, role: 'admin', admin_scope: scope } }, res, error => { throw error; });
        assert.equal(res.code, 403);
    }
});

test('applicant provider failures return safe JSON without download headers or false session-expired responses', async () => {
    try {
        for (const route of ['documents/1/file?download=1', 'resume/file?download=1', 'documents/download']) {
            for (const [status, expected] of [[401, 502], [403, 502], [404, route === 'documents/download' ? 400 : 404], [500, 502]]) {
                providerFailure = status;
                const response = await fetch(`${base}/api/applications/31/${route}`, { headers: auth(owner) });
                assert.equal(response.status, expected, `${route}: upstream ${status}`);
                assert.match(response.headers.get('content-type'), /application\/json/);
                assert.equal(response.headers.get('content-disposition'), null);
                assert.doesNotMatch(await response.text(), /private provider|fixture-secret|signature=|res.cloudinary/);
            }
        }
    } finally { providerFailure = 0; }
});
