const test = require('node:test');
const assert = require('node:assert/strict');
const { createAccountDeletion, POLICY } = require('../services/accountDeletion');
process.env.OBJECT_STORAGE_PROVIDER = 'cloudinary';
process.env.CLOUDINARY_CLOUD_NAME = 'account-deletion-fixture';
process.env.CLOUDINARY_API_KEY = 'fixture-key';
process.env.CLOUDINARY_API_SECRET = 'fixture-secret';
const { fileIdentity, containsIdentity } = require('../services/accountDeletionCleanup');
const Sequelize = require('sequelize');

test('deletion refuses unauthorized, cross-scope, self, invalid and unconfirmed requests before DB access', async () => {
    let connections = 0;
    const db = { Sequelize, sequelize: { transaction() { connections++; throw new Error('Must not connect'); } } };
    const service = createAccountDeletion({ db, env: { ACCOUNT_DELETION_POLICY: POLICY, JWT_SECRET: 'unit-test-secret' } });
    const actor = { id: 9, role: 'admin', admin_scope: 'employer' };
    const request = { actor, role: 'employer', id: 10, confirmation: 'DELETE' };
    for (const [change, status] of [[{ actor: null }, 401], [{ actor: { ...actor, role: 'employer' } }, 403],
        [{ role: 'alumni' }, 403], [{ id: 9 }, 403], [{ id: -1 }, 400], [{ id: 1.5 }, 400],
        [{ confirmation: 'delete' }, 400], [{ confirmationToken: 'forged' }, 409]]) {
        await assert.rejects(service.remove({ ...request, ...change }), error => error.status === status);
    }
    const gated = createAccountDeletion({ db, env: { JWT_SECRET: 'test' } });
    await assert.rejects(gated.remove(request), error => error.status === 403);
    assert.equal(connections, 0);
});

test('cleanup detects shared references in JSON snapshots and rejects unsafe filesystem references', () => {
    const reference = 'cld:' + Buffer.from(JSON.stringify({ provider: 'cloudinary', resourceType: 'raw', type: 'authenticated', publicId: 'private_uploads/a.pdf' })).toString('base64url');
    const identity = fileIdentity(reference);
    assert.ok(identity);
    assert.equal(containsIdentity(JSON.stringify({ documents: [{ storage_ref: reference }] }), identity), true);
    assert.equal(fileIdentity('/uploads/../../cert/ca.pem'), null);
    assert.equal(fileIdentity('/uploads/documents/%2e%2e/secret'), null);
    assert.equal(fileIdentity('C:/Windows/secret'), null);
    assert.equal(fileIdentity('/uploads/documents/fixture.pdf'), 'local:uploads/documents/fixture.pdf');
    assert.equal(fileIdentity('/uploads/documents/fixture.pdf:secret'), null);
    assert.equal(containsIdentity({ secure: `/api/files/secure/${Buffer.from(reference).toString('base64url')}` }, identity), true);
    const imageReference = 'cld:' + Buffer.from(JSON.stringify({ provider: 'cloudinary', resourceType: 'image', type: 'upload', publicId: 'photos/avatar', url: 'https://res.cloudinary.com/fixture/image/upload/v1/photos/avatar.png' })).toString('base64url');
    assert.equal(fileIdentity(imageReference), fileIdentity('https://res.cloudinary.com/fixture/image/upload/v1/photos/avatar.png'));
});

test('cleanup migration cannot be rolled back destructively', async () => {
    await assert.rejects(require('../migrations/20261102-create-account-deletion-files').down(), /destructive rollback is disabled/);
});

test('Cloudinary cleanup verifies provider outcomes and treats missing objects as an idempotent success', async () => {
    const { destroyStoredFile } = require('../services/objectStorage');
    const reference = 'cld:' + Buffer.from(JSON.stringify({ provider: 'cloudinary', resourceType: 'raw', type: 'authenticated', publicId: 'private_uploads/fixture.pdf' })).toString('base64url');
    const original = global.fetch;
    try {
        for (const [status, result, expected] of [[500, 'error', false], [200, 'error', false], [200, 'ok', true], [200, 'not found', true]]) {
            global.fetch = async (url, options) => {
                assert.equal(url, 'https://api.cloudinary.com/v1_1/account-deletion-fixture/raw/destroy');
                assert.ok(options.signal); return Response.json({ result }, { status });
            };
            assert.equal(await destroyStoredFile(reference, { verifyResult: true }), expected);
        }
    } finally { global.fetch = original; }
});
