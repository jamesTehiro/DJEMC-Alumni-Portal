// Generates synthetic documents only. It does not connect to or modify the database.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { buildMembershipDocumentHtml } = require('../services/membershipDocument');
const { renderResumePdf } = require('../services/resumePdf');

const output = path.resolve(__dirname, '..', '..', 'tmp', 'pdfs', 'membership-checks');
const record = {
    id: 1, application_status: 'Submitted', submitted_at: '2026-10-14T04:00:00Z',
    academic_program: 'BSIT', graduation_year: 2024,
    personal_details: { last_name: 'Dela Cruz', first_name: 'Alex', middle_name: 'Santos', extension: 'N/A',
        date_of_birth: '2000-03-15', civil_status: 'Single', sex: 'Female', place_of_birth: 'San Jose, Dinagat Islands',
        current_address: 'San Jose, Dinagat Islands', permanent_address: 'San Jose, Dinagat Islands',
        height: '165 cm', weight: '60 kg', blood_type: 'O+', citizenship: 'Filipino', tin: 'N/A', religion: 'N/A',
        occupation: 'Software Developer', designation: 'Developer', agency_office: 'Example Services',
        office_address: 'San Jose', social_media_account: 'N/A', contact_number: '+63 900 000 0000',
        email: 'alex@example.invalid', other_contact: 'N/A' },
    educational_attainment: ['Elementary', 'High School', 'Technical / Vocational', "Bachelor's Degree", "Master's Degree", 'Doctorate Degree'].map((level, index) => ({
        level, school_name: index === 3 ? 'Don Jose Ecleo Memorial College' : 'N/A', address: index === 3 ? 'San Jose, Dinagat Islands' : 'N/A',
        year_graduated: index === 3 ? 2024 : 'N/A', honors_awards: 'N/A', program: index === 3 ? 'BSIT' : ''
    })),
    work_experience: [{ employment_period: '2024 – Present', position: 'Developer', agency_employer: 'Example Services', employment_status: 'Full-time' }],
    training_seminars: [{ title: 'Professional Development Seminar', date: '2025-01-10', venue: 'San Jose', facilitator: 'Example Learning Center' }],
    community_involvement: [{ date: '2025-03-20', organization: 'Community Volunteers', designation: 'Volunteer', years: '1' }],
    awards_citations: [{ award: 'Service Award', date: '2025-06-10', venue: 'San Jose', awarding_body: 'Example Community Group' }],
    consent_accepted: true, consent_accepted_at: '2026-10-14T04:00:00Z', consent_version: 'membership-v1',
    options: {}
};

(async () => {
    fs.mkdirSync(output, { recursive: true });
    for (const [name, application] of [
        ['membership-standard', record],
        ['membership-work-experience-overflow', { ...record, work_experience: Array.from({ length: 28 }, (_, index) => ({
            employment_period: 'Employment period ' + (index + 1), position: 'Saved role ' + (index + 1),
            agency_employer: 'Example employer ' + (index + 1), employment_status: 'Full-time'
        })) }],
        ['membership-overflow', { ...record, training_seminars: Array.from({ length: 35 }, (_, index) => ({
            title: `Training ${index + 1}: ` + 'Long saved training information '.repeat(6), date: '2025-01-10',
            venue: 'San Jose, Dinagat Islands', facilitator: 'Example Learning Center'
        })) }]
    ]) {
        const html = buildMembershipDocumentHtml(application);
        const bytes = await renderResumePdf(html);
        assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
        assert.ok(bytes.length > 5000);
        const pages = (bytes.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length;
        if (name === 'membership-standard') assert.equal(pages, 2, 'Typical completed membership form should print on two A4 pages.');
        else assert.ok(pages > 2, 'Long repeatable records must continue on additional pages.');
        fs.writeFileSync(path.join(output, `${name}.pdf`), bytes);
        console.log(`PASS ${name}: real PDF generated; ${pages} pages, ${bytes.length} bytes.`);
    }
    console.log('Artifacts:', output);
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
