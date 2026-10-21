import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const compiled = buildSync({
    entryPoints: [fileURLToPath(new URL('../src/components/ApplicantDocumentWorkspace.jsx', import.meta.url))],
    bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external', jsx: 'automatic',
    define: { 'import.meta.env': '{}' }, loader: { '.css': 'empty' }, logLevel: 'silent',
});
const compiledModule = { exports: {} };
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(createRequire(import.meta.url), compiledModule, compiledModule.exports);
const Workspace = compiledModule.exports.default;
const render = application => renderToStaticMarkup(React.createElement(Workspace, { application, onDownload() {}, onView() {} }));
const sidebar = html => html.match(/<nav[\s\S]*?<\/nav>/)?.[0] || '';
const cardCount = html => (html.match(/class="applicant-document-card(?: |")/g) || []).length;

test('workspace shows the custom requirement, applicant identity, file and status without unrelated rows', () => {
    const html = render({
        id: 24, alumni: { name: 'Fixture Applicant' }, Job: { title: 'Technical Specialist' },
        JobRequirementSnapshot: { snapshot_data: { ungrouped: [{ requirement_code: 'custom_experience', label: 'Relevant Technical Experience', requirement_type: 'document_upload', required: true }] } },
        ApplicationDocuments: [{ id: 8, requirement_code: 'custom_experience', file_name: 'experience.pdf', review_status: 'needs_revision' }],
    });
    assert.equal(cardCount(html), 1);
    for (const value of ['Fixture Applicant', 'Technical Specialist', 'Relevant Technical Experience', 'experience.pdf', 'Required', 'needs revision']) assert.ok(html.includes(value), value);
    assert.doesNotMatch(sidebar(html), /<strong>(Resume|TOR|Valid ID)<\/strong>/);
    assert.match(html, />Open Document<\/button>/);
    assert.match(html, /> Download<\/button>/);
});

test('workspace retains configured missing rows and required/optional flags with download disabled', () => {
    const html = render({ id: 24, JobRequirementSnapshot: { snapshot_data: { ungrouped: [
        { requirement_code: 'resume', label: 'Updated CV', requirement_type: 'document_upload', required: true },
        { requirement_code: 'valid_govt_id', label: 'Government-issued identification', requirement_type: 'document_upload', required: false },
    ] } } });
    assert.equal(cardCount(html), 2);
    for (const value of ['Updated CV', 'Government-issued identification', 'Not submitted / unavailable', 'Required', 'Optional', 'This document was not submitted or has no accessible file record.']) assert.ok(html.includes(value), value);
    assert.match(html, /disabled=""/);
    assert.doesNotMatch(html, /Other submitted documents/);
});

test('workspace distinguishes additional and historical uploads without duplicating configured files', () => {
    const html = render({
        id: 24, transcript_path: '/api/files/historical-tor.pdf',
        JobRequirementSnapshot: { snapshot_data: { ungrouped: [{ requirement_code: 'portfolio', label: 'Work samples', requirement_type: 'document_upload', required: true }] } },
        ApplicationDocuments: [
            { id: 8, requirement_code: 'portfolio', file_name: 'work.pdf', review_status: 'approved' },
            { id: 9, requirement_code: 'older_license', file_name: 'license.docx', review_status: 'rejected' },
        ],
    });
    assert.equal(cardCount(html), 3);
    assert.equal((sidebar(html).match(/work\.pdf/g) || []).length, 1);
    for (const value of ['Other submitted documents', 'Additional attachment', 'Historical attachment', 'license.docx', 'historical-tor.pdf', 'approved', 'rejected']) assert.ok(html.includes(value), value);
    assert.ok(sidebar(html).indexOf('Work samples') < sidebar(html).indexOf('Other submitted documents'));
});

test('workspace handles empty and malformed snapshots explicitly without inventing missing documents', () => {
    for (const snapshot of [null, 'invalid JSON', { groups: [null, {}] }, { groups: [], ungrouped: [] }]) {
        const html = render({ id: 24, JobRequirementSnapshot: { snapshot_data: snapshot } });
        assert.equal(cardCount(html), 0);
        assert.match(html, /No document requirements or submitted files are available for this application\./);
        assert.doesNotMatch(sidebar(html), /Not submitted|<strong>(Resume|TOR|Valid ID)<\/strong>/);
        assert.match(html, /disabled=""/);
    }
});

test('both Employer and Admin Employer modals retain the shared workspace and existing action callbacks', () => {
    for (const page of ['EmployerPage', 'AdminEmployerPage']) {
        const source = readFileSync(new URL(`../src/pages/${page}.jsx`, import.meta.url), 'utf8');
        assert.match(source, /import ApplicantDocumentWorkspace, \{ ApplicantResumePrintButton \} from "\.\.\/components\/ApplicantDocumentWorkspace"/);
        assert.match(source, /<ApplicantDocumentWorkspace key=\{selectedApplication.id\} application=\{selectedApplication\} onDownload=\{downloadApplicationDocument\} onView=\{previewDocumentFile\} \/>/);
        assert.match(source, /<ApplicantResumePrintButton application=\{selectedApplication\} \/>/);
    }
});
