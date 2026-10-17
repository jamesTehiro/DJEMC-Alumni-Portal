import test from 'node:test';
import assert from 'node:assert/strict';
import { getApplicantDocumentEntries, getApplicantResumeDocument } from '../src/utils/applicantResume.js';
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
        ['tor', 'TOR', true],
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
    assert.equal(getApplicantResumeDocument({ resume_path: '/uploads/alex.pdf', JobRequirementSnapshot: { snapshot_data: { groups: [] } } }), null);
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
