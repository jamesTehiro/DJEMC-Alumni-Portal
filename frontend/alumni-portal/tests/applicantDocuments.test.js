import test from 'node:test';
import assert from 'node:assert/strict';
import { getApplicantDocumentEntries, getApplicantResumeDocument, getApplicantResumeFileUrl } from '../src/utils/applicantResume.js';
import { openApplicantResumePrintView } from '../src/utils/applicantResumePrint.js';

const application = () => ({
    id: 24,
    JobRequirementSnapshot: { snapshot_data: JSON.stringify({ groups: [{ requirements: [
        { requirement_code: 'resume', label: 'Resume', requirement_type: 'document_upload' },
        { requirement_code: 'transcript', label: 'Transcript of Records', requirement_type: 'document_upload' },
        { requirement_code: 'valid_id', label: 'Valid ID', requirement_type: 'document_upload' },
        { requirement_code: 'portfolio', label: 'Portfolio', requirement_type: 'document_upload' },
    ] }] }) },
    ApplicationDocuments: [
        { id: 11, requirement_code: 'resume', original_filename: 'alex-resume.pdf', mime_type: 'application/pdf', review_status: 'approved' },
        { id: 12, requirement_code: 'transcript', original_filename: 'transcript.pdf' },
        { id: 13, requirement_code: 'portfolio', original_filename: 'work.zip' },
    ],
});

test('document list identifies required kinds, keeps missing requirements, and sorts consistently', () => {
    const entries = getApplicantDocumentEntries(application());
    assert.deepEqual(entries.map(({ kind, label, available }) => [kind, label, available]), [
        ['resume', 'Resume', true],
        ['tor', 'Transcript of Records', true],
        ['id', 'Valid ID', false],
        ['other', 'Portfolio', true],
    ]);
    assert.equal(entries[0].reviewStatus, 'approved');
    assert.equal(entries[2].key, 'missing:valid_id');
});

test('legacy resume and protected TOR paths appear while arbitrary URLs stay unavailable', () => {
    const entries = getApplicantDocumentEntries({
        id: 'application/7',
        resume_path: '/uploads/alex.pdf',
        transcript_path: '/api/files/tor%20file.pdf',
        certificate_path: 'https://example.com/private.pdf',
    });
    assert.equal(entries.find(entry => entry.kind === 'resume').available, true);
    assert.equal(entries.find(entry => entry.kind === 'tor').document.authorizedFileUrl, '/api/files/tor%20file.pdf');
    assert.equal(entries.some(entry => entry.label === 'Certificate'), false);
    assert.equal(entries.length, 2);
    assert.ok(entries.every(entry => entry.source === 'legacy'));
    assert.equal(getApplicantResumeDocument({ resume_path: '/uploads/alex.pdf', JobRequirementSnapshot: { snapshot_data: { groups: [] } } }), null);
});

test('a custom-only job shows only its captured requirement and exact submitted file', () => {
    const document = { id: 51, requirement_code: 'custom_experience', file_name: 'experience.pdf', review_status: 'needs_revision' };
    const app = {
        id: 24,
        JobRequirementSnapshot: { snapshot_data: { ungrouped: [{ requirement_code: 'custom_experience', label: 'Relevant Technical Experience', requirement_type: 'document_upload', required: true }] } },
        ApplicationDocuments: [document],
    };
    const entries = getApplicantDocumentEntries(app);
    assert.equal(entries.length, 1);
    assert.deepEqual(entries.map(entry => [entry.label, entry.requirementCode, entry.source, entry.required, entry.reviewStatus]), [
        ['Relevant Technical Experience', 'custom_experience', 'configured', true, 'needs_revision'],
    ]);
    assert.equal(entries[0].document, document);
    assert.equal(getApplicantResumeFileUrl(app.id, entries[0].document), '/api/applications/24/documents/51/file');
});

test('explicit standard requirements retain configured labels and genuine missing-file indicators', () => {
    const app = { id: 24, JobRequirementSnapshot: { snapshot_data: { ungrouped: [
        { requirement_code: 'resume', label: 'Updated Curriculum Vitae', requirement_type: 'document_upload', required: true },
        { requirement_code: 'tor', label: 'Official academic transcript', requirement_type: 'document_upload', required: false },
        { requirement_code: 'valid_govt_id', label: 'Valid Government ID', requirement_type: 'document_upload', required: true },
    ] } } };
    const entries = getApplicantDocumentEntries(app);
    assert.equal(entries.length, 3);
    assert.deepEqual(entries.map(entry => [entry.label, entry.required, entry.available]), [
        ['Updated Curriculum Vitae', true, false], ['Official academic transcript', false, false], ['Valid Government ID', true, false],
    ]);
    assert.deepEqual(entries.map(entry => entry.key), ['missing:resume', 'missing:tor', 'missing:valid_govt_id']);
    assert.ok(entries.every(entry => entry.source === 'configured' && entry.document === null));
});

test('grouped and ungrouped documents match by code and retain flags and review states', () => {
    const app = {
        id: 24,
        JobRequirementSnapshot: { snapshot_data: JSON.stringify({ groups: [{ requirements: [
            { requirement_code: 'portfolio', label: 'Work samples', requirement_type: 'document_upload', required: 0 },
            { requirement_code: 'experience', label: 'Resume-related experience', requirement_type: 'information_field', required: true },
        ] }], ungrouped: [{ requirement_code: 'license', label: 'Professional license', requirement_type: 'document_upload', required: 1 }] }) },
        ApplicationDocuments: [
            { id: 21, requirement_code: 'portfolio', file_name: 'resume.pdf', review_status: 'rejected', review_notes: 'Unreadable' },
            { id: 22, requirement_code: 'license', file_name: 'license.png', review_status: 'approved' },
        ],
    };
    const entries = getApplicantDocumentEntries(app);
    assert.deepEqual(entries.map(entry => [entry.label, entry.required, entry.reviewStatus]), [
        ['Work samples', false, 'rejected'], ['Professional license', true, 'approved'],
    ]);
    assert.equal(entries[0].document.review_notes, 'Unreadable');
    assert.equal(getApplicantResumeDocument(app), null);
});

test('historical snapshots win over changed current job requirements without mutating records', () => {
    const app = application();
    app.Job = { current_requirement_version: 9, requirements: [{ requirement_code: 'new_id', label: 'New policy ID' }] };
    app.JobRequirementSnapshot.version = 1;
    const original = structuredClone(app);
    const entries = getApplicantDocumentEntries(app);
    assert.deepEqual(entries.map(entry => entry.requirementCode), ['resume', 'transcript', 'valid_id', 'portfolio']);
    assert.ok(entries.every(entry => entry.label !== 'New policy ID'));
    assert.deepEqual(app, original);
});

test('unmatched uploads remain separate and document IDs and requirement codes are not duplicated', () => {
    const app = application();
    app.JobRequirementSnapshot.snapshot_data = JSON.parse(app.JobRequirementSnapshot.snapshot_data);
    app.JobRequirementSnapshot.snapshot_data.ungrouped = [app.JobRequirementSnapshot.snapshot_data.groups[0].requirements[0]];
    app.ApplicationDocuments.push({ ...app.ApplicationDocuments[0] }, { id: 30, requirement_code: 'older_certificate', requirement_label: 'Previous certificate', file_name: 'old.pdf', review_status: 'needs_revision' });
    const entries = getApplicantDocumentEntries(app);
    assert.equal(entries.length, 5);
    assert.equal(entries.filter(entry => entry.document?.id === 11).length, 1);
    const extra = entries.find(entry => entry.document?.id === 30);
    assert.equal(extra.label, 'Previous certificate');
    assert.equal(extra.source, 'additional');
    assert.equal(extra.reviewStatus, 'needs_revision');
    assert.equal(extra.available, true);
});

test('legacy protected files are not duplicated when already attached to a configured requirement', () => {
    const app = {
        id: 24,
        transcript_path: '/api/files/official-tor.pdf',
        JobRequirementSnapshot: { snapshot_data: { ungrouped: [{ requirement_code: 'tor', label: 'Official TOR', requirement_type: 'document_upload' }] } },
        ApplicationDocuments: [{ id: 12, requirement_code: 'tor', file_path: '/api/files/official-tor.pdf', file_name: 'official-tor.pdf' }],
    };
    const entries = getApplicantDocumentEntries(app);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].source, 'configured');
    assert.equal(entries[0].label, 'Official TOR');
});

test('a historical upload does not hide a missing configured document or become its submission', () => {
    const app = {
        id: 24, transcript_path: '/api/files/older-tor.pdf',
        JobRequirementSnapshot: { snapshot_data: { ungrouped: [{ requirement_code: 'custom_transcript', label: 'Certified transcript', requirement_type: 'document_upload', required: true }] } },
    };
    const entries = getApplicantDocumentEntries(app);
    assert.deepEqual(entries.map(entry => [entry.source, entry.label, entry.available]), [
        ['configured', 'Certified transcript', false], ['legacy', 'TOR', true],
    ]);
});

test('empty or malformed snapshots never invent requirements or crash', () => {
    for (const snapshot of [undefined, null, '', 'invalid JSON', 'null', '[]', 5, [], {}, { groups: {} }, { groups: [null, { requirements: {} }] }, { ungrouped: [null, {}, { requirement_code: {}, requirement_type: 'document_upload' }] }]) {
        const app = { id: 24, JobRequirementSnapshot: { snapshot_data: snapshot }, ApplicationDocuments: [null, {}, 'bad'] };
        assert.deepEqual(getApplicantDocumentEntries(app), [], JSON.stringify(snapshot));
        const entries = getApplicantDocumentEntries({ ...app, ApplicationDocuments: [{ id: 20, requirement_code: 'old_file', file_name: 'older.pdf' }] });
        assert.equal(entries.length, 1);
        assert.equal(entries[0].source, 'additional');
        assert.equal(entries[0].available, true);
    }
    assert.deepEqual(getApplicantDocumentEntries(null), []);
    const legacy = getApplicantDocumentEntries({ id: 24, resume_path: '/uploads/resumes/old.pdf', JobRequirementSnapshot: { snapshot_data: 'invalid JSON' } });
    assert.equal(legacy.length, 1);
    assert.equal(legacy[0].source, 'legacy');
    assert.equal(legacy[0].document.isLegacyResume, true);
});

test('print action opens the popup synchronously and displays the fetched resume blob', async () => {
    const calls = [];
    const popup = { document: { body: { textContent: '' } }, location: { replace: url => calls.push(['replace', url]) }, focus: () => calls.push(['focus']), close: () => calls.push(['close']) };
    const blob = new Blob(['%PDF-1.7'], { type: 'application/pdf' });
    const result = await openApplicantResumePrintView(application(), {
        openWindow: () => { calls.push(['open']); return popup; },
        fetchDocument: async (...args) => { calls.push(['fetch', ...args]); return blob; },
        createObjectURL: value => { calls.push(['create', value]); return 'blob:resume'; },
        watchClosed: callback => { calls.push(['watch', callback]); return 8; },
        stopWatching: timer => calls.push(['stop', timer]),
    });
    assert.deepEqual(calls.slice(0, 2).map(call => call[0]), ['open', 'fetch']);
    assert.deepEqual(calls[1].slice(1), ['/api/applications/24/documents/11/file', true]);
    assert.equal(popup.document.title, 'alex-resume.pdf');
    assert.equal(popup.document.body.textContent, 'Preparing the uploaded resume for printing…');
    assert.equal(result.url, 'blob:resume');
    assert.ok(calls.some(call => call[0] === 'replace' && call[1] === 'blob:resume'));
    assert.ok(calls.some(call => call[0] === 'focus'));
});

test('print action rejects missing resumes, blocked popups, invalid responses, and unsupported formats', async () => {
    await assert.rejects(openApplicantResumePrintView({}, { openWindow: () => null }), /No uploaded resume/);
    const resume = { ...application(), ApplicationDocuments: application().ApplicationDocuments.slice(0, 1) };
    await assert.rejects(openApplicantResumePrintView(resume, { openWindow: () => null }), /Allow popups/);
    const popup = { document: { body: {} }, close() { this.closed = true; } };
    await assert.rejects(openApplicantResumePrintView(resume, { openWindow: () => popup, fetchDocument: async () => new Blob(['error'], { type: 'application/json' }) }), /did not return/);
    assert.equal(popup.closed, true);
    const wordResume = { ...resume, ApplicationDocuments: [{ ...resume.ApplicationDocuments[0], original_filename: 'resume.docx' }] };
    await assert.rejects(openApplicantResumePrintView(wordResume, { openWindow: () => ({ document: { body: {} }, close() {} }), fetchDocument: async () => new Blob(['word'], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }) }), /cannot be printed/);
});

test('print action revokes its object URL after the print tab closes', async () => {
    let closeTab;
    const revoked = [];
    const popup = { document: { body: {} }, location: { replace() {} }, focus() {}, closed: false };
    await openApplicantResumePrintView(application(), {
        openWindow: () => popup,
        fetchDocument: async () => new Blob(['pdf'], { type: 'application/pdf' }),
        createObjectURL: () => 'blob:resume',
        revokeObjectURL: url => revoked.push(url),
        watchClosed: callback => { closeTab = callback; return 9; },
        stopWatching: timer => revoked.push(`timer:${timer}`),
    });
    popup.closed = true;
    closeTab();
    assert.deepEqual(revoked, ['timer:9', 'blob:resume']);
});
