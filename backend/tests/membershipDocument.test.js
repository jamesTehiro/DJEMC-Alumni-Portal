const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMembershipDocumentHtml, ageAtSubmission, escapeHtml, PERSONAL_FIELDS } = require('../services/membershipDocument');

function fixture(overrides = {}) {
    return {
        id: 71, application_status: 'Submitted', submitted_at: '2026-10-14T04:15:00.000Z',
        academic_program: 'BSIT', graduation_year: 2024,
        personal_details: Object.fromEntries(PERSONAL_FIELDS.filter(([, field]) => field !== 'age').map(([label, field]) =>
            [field, field === 'date_of_birth' ? '2000-10-14' : `Saved ${label}`])),
        educational_attainment: [{ level: 'technical_vocational', school_name: 'Saved school', address: 'Saved school address',
            year_graduated: 2019, honors_awards: 'Saved education honors', competency: 'Saved competency', program: 'Saved program' }],
        work_experience: [{ employment_period: '2020–2026', position: 'Saved work position', agency_employer: 'Saved employer', employment_status: 'Permanent' }],
        training_seminars: [{ title: 'Saved training', date: '2025-01-10', venue: 'Saved training venue', facilitator: 'Saved facilitator' }],
        community_involvement: [{ date: '2024-02-03', organization: 'Saved community', designation: 'Saved community position', years: '2' }],
        awards_citations: [{ award: 'Saved award', date: '2024-11-21', venue: 'Saved award venue', awarding_body: 'Saved awarding body' }],
        consent_accepted: true, consent_accepted_at: '2026-10-14T04:15:00.000Z', consent_version: 'membership-v1',
        consent_text: 'Saved consent declaration.', ...overrides
    };
}

test('membership document renders saved fields from all six sections and official form headings', () => {
    const html = buildMembershipDocumentHtml(fixture());
    for (const [, field] of PERSONAL_FIELDS) {
        if (field === 'age' || field === 'date_of_birth') continue;
        assert.ok(html.includes(escapeHtml(fixture().personal_details[field])), field);
    }
    for (const section of ['educational_attainment', 'work_experience', 'training_seminars', 'community_involvement', 'awards_citations']) {
        for (const [key, value] of Object.entries(fixture()[section][0])) {
            if (!['level', 'program', 'competency'].includes(key)) assert.ok(html.includes(escapeHtml(value)), `${section}.${key}`);
        }
    }
    assert.ok(html.includes('Technical / Vocational'));
    assert.ok(html.includes('DON JOSE ECLEO MEMORIAL COLLEGE'));
    assert.ok(html.includes('P-5 Justiniana Edera, San Jose, Dinagat Islands'));
    assert.ok(html.includes('ALUMNI ASSOCIATION'));
    assert.ok(html.includes('VI. AWARDS / CITATION RECEIVED'));
    assert.ok(html.includes('October 14, 2000'));
    assert.ok(html.includes('Batch 2024'));
    assert.ok(html.includes('data-membership-application-id="71"'));
});

test('membership document uses stored consent version, text and timestamp without fabricating approval', () => {
    const html = buildMembershipDocumentHtml(fixture({ approved_by: 'Must not appear', approved_at: 'Must not appear' }));
    assert.ok(html.includes('Saved consent declaration.'));
    assert.ok(html.includes('membership-v1'));
    assert.ok(html.includes('Accepted electronically'));
    assert.ok(html.includes('October 14, 2026'));
    assert.ok(html.includes('does not constitute association membership approval'));
    assert.ok(html.includes('Signature Over-Printed Name'));
    assert.ok(html.includes('Approved during BOT Meeting on:</th><td></td>'));
    assert.ok(html.includes('Resolution No.:</th><td></td>'));
    assert.ok(html.includes('Verified:</th><td></td>'));
    assert.ok(html.includes('Attested:</th><td></td>'));
    assert.ok(html.includes('Approved:</th><td></td>'));
    assert.ok(html.includes('Checked:<br>Committee on Membership</th><td></td>'));
    assert.ok(!html.includes('Must not appear'));
});

test('membership document escapes submitted content in title, fields, rows, consent and identifiers', () => {
    const attack = '</td><script>alert("private")</script><img src="https://example.invalid">';
    const record = fixture({ id: attack, consent_text: attack, consent_version: attack,
        personal_details: { first_name: attack, last_name: attack, current_address: attack },
        work_experience: [{ agency_employer: attack, position: attack }],
        educational_attainment: [{ level: attack, program: attack, competency: attack }]
    });
    const html = buildMembershipDocumentHtml(record);
    assert.ok(html.includes(escapeHtml(attack)));
    assert.ok(!html.includes('<script>'));
    assert.ok(!html.includes('<img'));
    assert.ok(!html.includes('<input'));
    assert.ok(!html.includes('<form'));
    assert.ok(!html.includes('src="https://example.invalid"'));
});

test('membership document safely handles optional empty sections and older JSON values', () => {
    const html = buildMembershipDocumentHtml(fixture({ personal_details: '{}', options: JSON.stringify({ no_work_experience: true,
        no_training_seminars: true, no_community_involvement: true, no_awards_citations: true }), educational_attainment: 'not valid JSON',
        work_experience: [], training_seminars: null, community_involvement: undefined, awards_citations: [],
        consent_accepted: false, consent_accepted_at: null
    }));
    for (const text of ['No Work Experience', 'No training or seminar information applies.', 'No community involvement information applies.',
        'No award or citation information applies.', 'No educational information provided.', 'Not recorded']) {
        assert.ok(html.includes(text));
    }
    assert.ok(!html.includes('Accepted electronically'));
    assert.throws(() => buildMembershipDocumentHtml(null), /saved membership application/);
});

test('membership document supports every repeatable row and additional A4 pages without clipping', () => {
    const rows = Array.from({ length: 80 }, (_, index) => ({ employment_period: `Employment ${index}`,
        position: `Distinct saved role ${index}`, agency_employer: 'Long employer description '.repeat(20), employment_status: 'Full-time' }));
    const html = buildMembershipDocumentHtml(fixture({ work_experience: rows }));
    assert.ok(html.includes('Distinct saved role 0'));
    assert.ok(html.includes('Distinct saved role 79'));
    assert.equal((html.match(/Distinct saved role/g) || []).length, 80);
    assert.ok(html.includes('@page { size: A4 portrait;'));
    assert.ok(html.includes('thead { display: table-header-group; }'));
    assert.ok(html.includes('break-inside: avoid'));
    assert.ok(!html.includes('overflow: hidden'));
    const secondPart = html.indexOf('<article class="membership-part">', html.indexOf('<article class="membership-part">') + 1);
    assert.ok(html.indexOf('III. WORK EXPERIENCE') < secondPart);
    assert.ok(html.indexOf('IV. TRAINING / WORKSHOP / SEMINAR') > secondPart);
});

test('membership document calculates age at the saved submission date without changing after birthdays', () => {
    assert.equal(ageAtSubmission('2000-10-14', '2026-10-14T00:00:00Z'), '26');
    assert.equal(ageAtSubmission('2000-10-15', '2026-10-14T00:00:00Z'), '25');
    assert.equal(ageAtSubmission('2000-10-14', '2026-10-13T17:00:00Z'), '26');
    assert.equal(ageAtSubmission('2030-01-01', '2026-10-14T00:00:00Z'), '—');
    assert.equal(ageAtSubmission('unknown', '2026-10-14T00:00:00Z'), '—');
    assert.equal(ageAtSubmission('2000-02-31', '2026-10-14T00:00:00Z'), '—');
});

test('membership document retains the six official education levels without inventing missing records', () => {
    const html = buildMembershipDocumentHtml(fixture({ educational_attainment: [{ level: "Bachelor's Degree", school_name: 'Only saved school' }] }));
    for (const level of ['Elementary', 'High School', 'Technical / Vocational', "Bachelor's Degree", 'Masteral Degree', 'Doctorate Degree']) {
        assert.ok(html.includes(escapeHtml(level)));
    }
    assert.equal((html.match(/Only saved school/g) || []).length, 1);
    assert.ok(!html.includes('Saved education honors'));
    const optionalName = buildMembershipDocumentHtml(fixture({ personal_details: { first_name: 'Alex', last_name: 'Cruz', middle_name: 'N/A', extension: 'N/A' } }));
    assert.ok(optionalName.includes('Applicant name recorded electronically:</strong> Alex Cruz</p>'));
});

test('membership document accepts a Sequelize record without exposing unrelated model properties', () => {
    const html = buildMembershipDocumentHtml({ get: options => {
        assert.deepEqual(options, { plain: true });
        return { ...fixture(), password: 'PrivatePasswordNotRendered', internal_note: 'PrivateNoteNotRendered' };
    } });
    assert.ok(!html.includes('PrivatePasswordNotRendered'));
    assert.ok(!html.includes('PrivateNoteNotRendered'));
});

test('education document has only address, year and awards beside level and school, hiding legacy fields', () => {
 const record = fixture();
 const html = buildMembershipDocumentHtml(record);
 const education = html.split('II. EDUCATIONAL ATTAINMENT')[1].split('</section>')[0];
 for (const label of ['Education Level / School', 'School Address', 'Year Graduated', 'Honor / Awards']) assert.ok(education.includes(label));
 assert.equal((education.match(/scope="col"/g) || []).length, 4);
 for (const hidden of ['Saved program', 'Saved competency', 'Level / Program or Competency', 'BSIT']) assert.ok(!html.includes(hidden), hidden);
 assert.equal(record.educational_attainment[0].program, 'Saved program');
 assert.equal(record.educational_attainment[0].competency, 'Saved competency');
});
