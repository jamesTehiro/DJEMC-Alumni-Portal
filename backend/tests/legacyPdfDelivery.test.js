const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
process.env.OBJECT_STORAGE_PROVIDER = 'cloudinary';
process.env.CLOUDINARY_CLOUD_NAME = 'legacy-pdf-fixture';
process.env.CLOUDINARY_API_KEY = 'fixture-key';
process.env.CLOUDINARY_API_SECRET = 'fixture-secret';
const storage = require('../services/objectStorage');
const pdf = Buffer.from('%PDF-1.7\nlegacy fixture\n%%EOF');
const asset = { provider: 'cloudinary', resourceType: 'raw', type: 'upload', publicId: 'private_uploads/resumes/legacy.pdf', url: 'https://res.cloudinary.com/legacy-pdf-fixture/raw/upload/v123/private_uploads/resumes/legacy.pdf' };
const encode = value => 'cld:' + Buffer.from(JSON.stringify(value)).toString('base64url');

test('legacy raw PDF CDN 401/403 retries the signed private API without changing stored references', async () => {
    const originalFetch = global.fetch;
    try {
        for (const status of [401, 403]) for (const reference of [encode(asset), asset.url]) {
            const requests = [];
            global.fetch = async source => {
                const url = new URL(source); requests.push(url);
                if (url.hostname === 'res.cloudinary.com') return new Response('Delivery restricted', { status });
                assert.equal(url.hostname, 'api.cloudinary.com');
                assert.equal(url.pathname, '/v1_1/legacy-pdf-fixture/raw/download');
                assert.equal(url.searchParams.get('public_id'), asset.publicId);
                assert.equal(url.searchParams.get('type'), 'upload');
                assert.equal(url.searchParams.get('format'), 'pdf');
                const params = [...url.searchParams].filter(([key]) => !['signature', 'api_key'].includes(key));
                const payload = params.sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('&');
                assert.equal(url.searchParams.get('signature'), crypto.createHash('sha1').update(payload + 'fixture-secret').digest('hex'));
                return new Response(pdf, { headers: { 'Content-Type': 'application/pdf' } });
            };
            assert.deepEqual((await storage.readStoredFile(reference)).buffer, pdf);
            assert.equal(requests.length, 2);
            assert.equal(requests[0].href, asset.url);
        }
    } finally { global.fetch = originalFetch; }
});

test('legacy fallback never retries missing assets, outages or assets from another account', async () => {
    const originalFetch = global.fetch;
    try {
        for (const [reference, status] of [[encode(asset), 404], [encode(asset), 500], [asset.url.replace('legacy-pdf-fixture', 'another-account'), 401]]) {
            let calls = 0;
            global.fetch = async () => { calls++; return new Response('Provider failure', { status }); };
            await assert.rejects(storage.readStoredFile(reference), error => error.status === status);
            assert.equal(calls, 1);
        }
    } finally { global.fetch = originalFetch; }
});

test('failure of both legacy delivery methods retains the upstream failure and never returns error bytes', async () => {
    const originalFetch = global.fetch;
    try {
        let calls = 0;
        global.fetch = async () => { calls++; return new Response('private provider detail', { status: 401 }); };
        await assert.rejects(storage.readStoredFile(encode(asset)), error => error.status === 401 && !JSON.stringify(error).includes('private provider detail'));
        assert.equal(calls, 2);
    } finally { global.fetch = originalFetch; }
});
