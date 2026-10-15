import test from 'node:test';
import assert from 'node:assert/strict';
import { createResumeDraft, normalizeResume, persistResume, restoreResumeDraft, resumeFingerprint, resumePayload,
    unwrapResume, unwrapResumeList, validateResume } from '../src/utils/resumeWorkflow.js';

const draft = () => createResumeDraft({ id: 7, name: 'Alex Graduate', email: 'alex@example.com', AlumniProfile: { address: 'Manila', phone: '09123456789', job_title: 'Developer', avatar_url: '/uploads/photo.jpg' } }, 'draft-123');

test('new drafts prefill profile fields without creating a database record', () => {
    const resume = draft();
    assert.equal(resume.id, undefined);
    assert.equal(resume.personalInfo.full_name, 'Alex Graduate');
    assert.equal(resume.personalInfo.photo_url, '/uploads/photo.jpg');
    assert.equal(resume.settings.client_draft_id, 'draft-123');
    assert.deepEqual(resume.references, []);
});

test('required field validation distinguishes missing and invalid email', () => {
    assert.deepEqual(validateResume({}), { full_name: 'Enter your full name.', email: 'Enter your email address.' });
    assert.equal(validateResume({ personalInfo: { full_name: ' Alex ', email: 'wrong' } }).email, 'Enter a valid email address.');
    assert.deepEqual(validateResume(draft()), {});
});

test('normalization retains all sections, data URLs and fields while adapting saved dates', () => {
    const resume = normalizeResume({ personalInfo: [{ full_name: 'Alex', photo_url: 'data:image/png;base64,abcd' }], summary: [{ content: 'Summary' }],
        education: [{ institution: 'DJEMC', gpa: '1.5', start_date: '2024-08-01T00:00:00.000Z' }], organizations: [{ organization_name: 'Alumni Association', position: 'Chair' }],
        projects: [{ project_name: 'Project', technologies: 'React' }], languages: [{ language: 'English' }], settings: '{"test":true}' });
    assert.equal(resume.education[0].start_date, '2024-08-01');
    assert.equal(resume.education[0].gpa, '1.5');
    assert.equal(resume.organizations[0].organization_name, 'Alumni Association');
    assert.equal(resume.languages[0].language, 'English');
    assert.equal(resume.personalInfo.photo_url, 'data:image/png;base64,abcd');
    assert.equal(resume.settings.test, true);
    assert.deepEqual(resume.awards, []);
});

test('editing a loaded organization name uses the actual persisted field', () => {
    const original = normalizeResume({ organizations: [{ organization_name: 'Before', name: 'Old alias' }] });
    const edited = normalizeResume({ ...original, organizations: [{ ...original.organizations[0], organization_name: 'After' }] });
    assert.equal(resumePayload(edited).organizations[0].organization_name, 'After');
});

test('payloads preserve complete resume data and strip parent ownership metadata', () => {
    const resume = { ...draft(), id: 4, user_id: 7, createdAt: 'yesterday', projects: [{ project_name: 'Sample', technologies: 'React', url: 'example.com' }] };
    const payload = resumePayload(resume);
    assert.equal(payload.id, undefined); assert.equal(payload.user_id, undefined);
    assert.equal(payload.createdAt, undefined);
    assert.equal(payload.settings.client_draft_id, 'draft-123');
    assert.equal(payload.projects[0].technologies, 'React');
});

test('moving steps and changing a template retain information and only mark the draft dirty', () => {
    const saved = { ...draft(), id: 4 };
    const changed = normalizeResume({ ...saved, template_id: 'minimal-black-white' });
    assert.deepEqual(changed.personalInfo, saved.personalInfo);
    assert.notEqual(resumeFingerprint(changed), resumeFingerprint(saved));
    assert.equal(saved.template_id, 'modern-professional');
});

test('new save sends all fields once and reloads the acknowledged saved record', async () => {
    const calls = [];
    const api = { post: async (path, payload) => { calls.push(['POST', path, payload]); return { data: { id: 41 } }; }, get: async path => { calls.push(['GET', path]); return { ...draft(), id: 41 }; } };
    let acknowledged;
    const saved = await persistResume({ api, resume: draft(), onIdentified: id => { acknowledged = id; } });
    assert.equal(saved.id, 41); assert.equal(acknowledged, 41);
    assert.equal(calls[0][2].personalInfo.full_name, 'Alex Graduate');
    assert.deepEqual(calls.map(call => call.slice(0, 2)), [['POST', '/resumes'], ['GET', '/resumes/41']]);
});

test('repeated saves update the same record with PUT and never POST another resume', async () => {
    const calls = [];
    const api = { put: async path => calls.push(path), get: async () => ({ ...draft(), id: 41 }), post: async () => { throw new Error('Unexpected create'); } };
    const saved = await persistResume({ api, resume: { ...draft(), id: 41 } });
    await persistResume({ api, resume: { ...saved, title: 'Updated' } });
    assert.deepEqual(calls, ['/resumes/41', '/resumes/41']);
});

test('a retried create applies edits made after a lost response to the reused record', async () => {
    const calls = [];
    const edited = { ...draft(), title: 'Changed after retry' };
    const api = {
        post: async () => ({ data: { id: 41 }, reused: true }),
        put: async (path, body) => { calls.push([path, body.title]); },
        get: async () => ({ ...edited, id: 41 })
    };
    const saved = await persistResume({ api, resume: edited });
    assert.deepEqual(calls, [['/resumes/41', 'Changed after retry']]);
    assert.equal(saved.title, 'Changed after retry');
});

test('a failed reused-record update retains its ID and does not return stale saved data', async () => {
    let acknowledged;
    let reloaded = false;
    await assert.rejects(persistResume({ api: {
        post: async () => ({ data: { id: 41 }, reused: true }),
        put: async () => { throw new Error('Update failed'); },
        get: async () => { reloaded = true; return { id: 41 }; }
    }, resume: draft(), onIdentified: id => { acknowledged = id; } }), /Update failed/);
    assert.equal(acknowledged, 41); assert.equal(reloaded, false);
});

test('a failed detail reload preserves the acknowledged ID for a safe update retry', async () => {
    let current = draft();
    const api = { post: async () => ({ data: { id: 41 } }), get: async () => { throw new Error('Reload failed'); } };
    await assert.rejects(persistResume({ api, resume: current, onIdentified: id => { current = { ...current, id }; } }), /Reload failed/);
    assert.equal(current.id, 41);
    let usedPut = false;
    await persistResume({ api: { ...api, put: async () => { usedPut = true; }, get: async () => current }, resume: current });
    assert.equal(usedPut, true);
});

test('failed saves and invalid responses never return a successful saved version', async () => {
    await assert.rejects(persistResume({ api: { post: async () => { throw new Error('Database unavailable'); } }, resume: draft() }), /Database unavailable/);
    await assert.rejects(persistResume({ api: { post: async () => ({ data: {} }) }, resume: draft() }), /invalid resume/);
    await assert.rejects(persistResume({ api: { put: async () => {}, get: async () => ({ id: 99 }) }, resume: { ...draft(), id: 41 } }), /could not be verified/);
    assert.throws(() => unwrapResumeList({ data: null }), /invalid resume list/);
    assert.throws(() => unwrapResume(null), /invalid resume/);
});

test('cached drafts restore only for their owner and an accessible existing record', () => {
    const cached = JSON.stringify({ version: 1, userId: 7, resume: { ...draft(), id: 41 } });
    assert.equal(restoreResumeDraft(cached, 7, [{ id: 41 }]).id, 41);
    assert.equal(restoreResumeDraft(cached, 8, [{ id: 41 }]), null);
    assert.equal(restoreResumeDraft(cached, 7, [{ id: 42 }]), null);
    assert.equal(restoreResumeDraft('{broken}', 7, []), null);
});

test('photo replacement and removal remain part of the saved payload', () => {
    const resume = draft();
    const replaced = { ...resume, personalInfo: { ...resume.personalInfo, photo_url: 'data:image/jpeg;base64,new' } };
    assert.equal(resumePayload(replaced).personalInfo.photo_url, 'data:image/jpeg;base64,new');
    const removed = { ...replaced, personalInfo: { ...replaced.personalInfo, photo_url: null } };
    assert.equal(resumePayload(removed).personalInfo.photo_url, null);
});
