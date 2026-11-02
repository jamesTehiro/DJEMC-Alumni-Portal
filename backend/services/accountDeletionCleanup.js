const fs = require('node:fs/promises');
const path = require('node:path');
const { parseStoredFileReference, destroyStoredFile } = require('./objectStorage');
const { normalizeStoredPath } = require('../utils/storedFiles');

// Canonical identities also recognize the same object stored through another
// encoded reference. Unsupported references are held for manual review.
function fileIdentity(value) {
    if (typeof value !== 'string') return null;
    // Comparison also recognizes secure API wrappers and legacy absolute paths.
    // Actual filesystem deletion below still accepts only a validated root path.
    const wrapped = value.match(/(?:^|\/)api\/files\/secure\/([A-Za-z0-9_-]+)(?:\?.*)?$/);
    if (wrapped) {
        const decoded = Buffer.from(wrapped[1], 'base64url').toString('utf8');
        if (decoded === value) return null;
        // Wrappers emitted by this system contain a raw reference, never another wrapper.
        if (/(?:^|\/)api\/files\/secure\//.test(decoded)) return null;
        return fileIdentity(decoded);
    }
    const canonicalPublicId = (resource, id) => ['image', 'video'].includes(resource)
        ? id.replace(/\.(?:jpe?g|png|gif|webp|avif|bmp|pdf|mp4|webm|mov)$/i, '') : id;
    const cloud = parseStoredFileReference(value);
    if (cloud?.provider === 'cloudinary' && ['image', 'raw', 'video'].includes(cloud.resourceType) && ['upload', 'authenticated', 'private'].includes(cloud.type)
        && /^[A-Za-z0-9._/-]+$/.test(cloud.publicId || '') && !cloud.publicId.split('/').some(part => !part || part === '.' || part === '..')) {
        return `cloudinary:${cloud.resourceType}:${cloud.type}:${canonicalPublicId(cloud.resourceType, cloud.publicId)}`;
    }
    const normalized = normalizeStoredPath(value) || value.replace(/\\/g, '/');
    if (/^\/?(?:uploads|private_uploads)\//.test(normalized)) {
        const parts = normalized.replace(/^\//, '').split('/');
        if (parts.some(part => !part || part === '.' || part === '..' || /[%\x00-\x1f:]/.test(part))) return null;
        return `local:${parts.join('/')}`;
    }
    // Public URLs may also refer to files otherwise stored with a cld: reference.
    try {
        const url = new URL(value);
        if (url.hostname === 'res.cloudinary.com') {
            const parts = url.pathname.split('/').filter(Boolean);
            if (parts.length >= 5 && /^v\d+$/.test(parts[3])) return `cloudinary:${parts[1]}:${parts[2]}:${canonicalPublicId(parts[1], decodeURIComponent(parts.slice(4).join('/')))}`;
        }
    } catch { /* not an absolute provider URL */ }
    return null;
}

function containsIdentity(value, identity) {
    if (typeof value === 'string') {
        if (fileIdentity(value) === identity) return true;
        try { return containsIdentity(JSON.parse(value), identity); } catch { return false; }
    }
    if (Array.isArray(value)) return value.some(item => containsIdentity(item, identity));
    if (value && typeof value === 'object') return Object.values(value).some(item => containsIdentity(item, identity));
    return false;
}

function createCleanup({ db, removeFile, now = () => new Date() }) {
    const { Op } = db.Sequelize;
    async function referenced(identity) {
        // Include JSON snapshots, retained membership forms, shared attachments
        // and legacy file columns. Never consider cleanup outbox references owners.
        const seen = new Set();
        for (const Model of Object.values(db)) {
            if (!Model?.rawAttributes || Model === db.AccountDeletionFile || seen.has(Model)) continue;
            seen.add(Model);
            const text = Object.entries(Model.rawAttributes).filter(([, attr]) => ['STRING', 'TEXT', 'JSON', 'CHAR'].includes(attr.type.key)).map(([key]) => key);
            if (!text.length) continue;
            const keys = Model.primaryKeyAttributes;
            if (!keys.length) throw new Error('MANUAL_REVIEW');
            let last = null;
            for (;;) {
                // Primary-key pagination cannot skip surviving rows when earlier
                // rows are concurrently removed, as OFFSET pagination could.
                const where = last ? { [Op.or]: keys.map((key, index) => ({
                    ...Object.fromEntries(keys.slice(0, index).map(previous => [previous, last[previous]])),
                    [key]: { [Op.gt]: last[key] }
                })) } : undefined;
                const rows = await Model.unscoped().findAll({ attributes: [...new Set([...keys, ...text])], where, order: keys.map(key => [key, 'ASC']), limit: 200, raw: true });
                if (rows.some(row => containsIdentity(row, identity))) return true;
                if (rows.length < 200) break;
                last = rows.at(-1);
            }
        }
        return false;
    }
    async function destroy(reference) {
        if (removeFile) return removeFile(reference);
        const parsed = parseStoredFileReference(reference);
        if (parsed) {
            let source;
            try { source = new URL(parsed.url); } catch { throw new Error('MANUAL_REVIEW'); }
            const parts = source.pathname.split('/').filter(Boolean);
            if (source.protocol !== 'https:' || source.hostname !== 'res.cloudinary.com' || source.port || source.username || source.password
                || parts[0] !== process.env.CLOUDINARY_CLOUD_NAME || parts[1] !== parsed.resourceType || parts[2] !== parsed.type) throw new Error('MANUAL_REVIEW');
            let assetIndex = 3;
            if (/^s--[A-Za-z0-9_-]+--$/.test(parts[assetIndex])) assetIndex++;
            if (/^v\d+$/.test(parts[assetIndex])) assetIndex++;
            let asset;
            try { asset = decodeURIComponent(parts.slice(assetIndex).join('/')); } catch { throw new Error('MANUAL_REVIEW'); }
            if (asset !== parsed.publicId && !(parsed.resourceType !== 'raw' && asset.startsWith(parsed.publicId + '.') && /^\.[a-z0-9]+$/i.test(asset.slice(parsed.publicId.length)))) throw new Error('MANUAL_REVIEW');
            // The existing helper returns only HTTP status. Verify the provider
            // result explicitly so a 200 error payload is never marked completed.
            if (!await destroyStoredFile(reference, { verifyResult: true })) throw new Error('PROVIDER_RETRY');
            return;
        }
        const identity = fileIdentity(reference);
        if (!identity?.startsWith('local:')) throw new Error('MANUAL_REVIEW');
        const relative = identity.slice(6);
        const root = path.resolve(__dirname, '..', relative.split('/')[0]);
        const target = path.resolve(__dirname, '..', relative);
        if (!target.startsWith(root + path.sep)) throw new Error('MANUAL_REVIEW');
        // Refuse symlinks/junctions through existing ancestors.
        let current = target;
        while (current !== path.dirname(root)) {
            try { if ((await fs.lstat(current)).isSymbolicLink()) throw new Error('MANUAL_REVIEW'); }
            catch (error) { if (error.code !== 'ENOENT') throw error; }
            current = path.dirname(current);
        }
        try { await fs.unlink(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    async function processOne() {
        // A DB lease is durable across worker crashes; expired processing entries
        // are retried. Repeating a successful provider deletion is idempotent.
        const job = await db.sequelize.transaction(async transaction => {
            const row = await db.AccountDeletionFile.findOne({ where: { status: { [Op.in]: ['pending', 'processing'] }, next_attempt_at: { [Op.lte]: now() } },
                order: [['id', 'ASC']], transaction, lock: transaction.LOCK.UPDATE, skipLocked: true });
            if (!row) return null;
            await row.update({ status: 'processing', attempts: row.attempts + 1, next_attempt_at: new Date(now().getTime() + 15 * 60 * 1000) }, { transaction });
            return row;
        });
        if (!job) return false;
        const record = values => db.AccountDeletionFile.update(values, { where: { id: job.id, status: 'processing', attempts: job.attempts } });
        try {
            const identity = fileIdentity(job.reference);
            if (!identity) throw new Error('MANUAL_REVIEW');
            if (await referenced(identity)) {
                await record({ status: 'retained', last_error: 'STILL_REFERENCED' });
            } else {
                await destroy(job.reference);
                await record({ status: 'completed', reference: '[removed]', last_error: null });
            }
        } catch (error) {
            const manual = error.message === 'MANUAL_REVIEW' || job.attempts >= 10;
            await record({ status: manual ? 'manual_review' : 'pending', last_error: manual ? 'MANUAL_REVIEW' : 'CLEANUP_RETRY',
                next_attempt_at: new Date(now().getTime() + Math.min(86400000, 60000 * 2 ** Math.min(job.attempts, 10))) });
        }
        return true;
    }
    return { processOne, referenced };
}
module.exports = { createCleanup, fileIdentity, containsIdentity };
