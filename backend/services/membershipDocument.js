const DECLARATION = 'I hereby certify that the above-mentioned information/data is true and correct. I acknowledge that the provided information will be kept confidential and used solely for the stated purpose. My personal data will not be shared with third parties without my explicit consent, except as required by law.';

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[character]));
}

function structured(value, fallback) {
    if (value && typeof value === 'object') return value;
    if (typeof value === 'string') {
        try { return JSON.parse(value); } catch { /* Older empty values render safely. */ }
    }
    return fallback;
}

function printable(value) {
    return value === undefined || value === null || String(value).trim() === '' ? '—' : escapeHtml(value);
}

function dateLabel(value, withTime = false) {
    if (!value) return 'Not recorded';
    // Date-only fields have no timezone; do not shift the applicant's birth or graduation date.
    const dateOnly = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
    const date = new Date(dateOnly ? `${value}T12:00:00Z` : value);
    if (Number.isNaN(date.getTime())) return escapeHtml(value);
    return escapeHtml(new Intl.DateTimeFormat('en-US', {
        month: 'long', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila',
        ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {})
    }).format(date));
}

function ageAtSubmission(dateOfBirth, submittedAt) {
    const birth = String(dateOfBirth || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!birth) return '—';
    const birthDate = new Date(`${birth[1]}-${birth[2]}-${birth[3]}T00:00:00Z`);
    if (Number.isNaN(birthDate.getTime()) || birthDate.getUTCFullYear() !== Number(birth[1]) ||
        birthDate.getUTCMonth() + 1 !== Number(birth[2]) || birthDate.getUTCDate() !== Number(birth[3])) return '—';
    const reference = new Date(submittedAt || Date.now());
    if (Number.isNaN(reference.getTime())) return '—';
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Manila', year: 'numeric', month: 'numeric', day: 'numeric'
    }).formatToParts(reference);
    const part = name => Number(parts.find(item => item.type === name)?.value);
    const age = part('year') - Number(birth[1]) - (part('month') < Number(birth[2]) ||
        (part('month') === Number(birth[2]) && part('day') < Number(birth[3])) ? 1 : 0);
    return age >= 0 && age <= 130 ? String(age) : '—';
}

const PERSONAL_FIELDS = [
    ['Last Name', 'last_name'], ['First Name', 'first_name'], ['Middle Name', 'middle_name'], ['Extension', 'extension'],
    ['Date of Birth', 'date_of_birth'], ['Age (at submission)', 'age'], ['Civil Status', 'civil_status'], ['Sex', 'sex'],
    ['Place of Birth', 'place_of_birth'], ['Current Address', 'current_address'], ['Permanent Address', 'permanent_address'],
    ['Height', 'height'], ['Weight', 'weight'], ['Blood Type', 'blood_type'], ['Citizenship', 'citizenship'], ['TIN', 'tin'],
    ['Religion (Denomination)', 'religion'], ['Occupation', 'occupation'], ['Designation', 'designation'],
    ['Agency / Office Affiliated', 'agency_office'], ['Office Address', 'office_address'], ['Social Media Account', 'social_media_account'],
    ['Contact Number', 'contact_number'], ['Email', 'email'], ['Other Ways to Be Contacted', 'other_contact']
];

const EDUCATION_LEVELS = {
    elementary: 'Elementary', high_school: 'High School', technical_vocational: 'Technical / Vocational',
    bachelors: "Bachelor's Degree", bachelor: "Bachelor's Degree", masters: 'Masteral Degree', master: 'Masteral Degree',
    doctorate: 'Doctorate Degree', technical: 'Technical / Vocational', vocational: 'Technical / Vocational'
};

function officialEducationRows(value) {
    const rows = Array.isArray(value) ? value.filter(row => row && typeof row === 'object') : [];
    const levels = ['Elementary', 'High School', 'Technical / Vocational', "Bachelor's Degree", 'Masteral Degree', 'Doctorate Degree'];
    const key = level => String(EDUCATION_LEVELS[level] || level || '').toLowerCase().replace(/[^a-z]/g, '').replace(/^masters?degree$/, 'masteraldegree');
    const used = new Set();
    const result = levels.map(level => {
        const index = rows.findIndex((row, index) => !used.has(index) && key(row.level) === key(level));
        if (index >= 0) { used.add(index); return { ...rows[index], level }; }
        return { level };
    });
    return result.concat(rows.filter((row, index) => !used.has(index)));
}

function sectionTable(title, rows, columns, emptyMessage) {
    const safeRows = Array.isArray(rows) ? rows.filter(row => row && typeof row === 'object') : [];
    return `<section class="membership-section"><h2>${escapeHtml(title)}</h2><table><thead><tr>${columns.map(column => `<th scope="col">${escapeHtml(column.label)}</th>`).join('')}</tr></thead><tbody>${safeRows.length ? safeRows.map(row => `<tr>${columns.map(column => `<td>${column.render ? column.render(row) : printable(row[column.key])}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${columns.length}" class="empty-records">${escapeHtml(emptyMessage)}</td></tr>`}</tbody></table></section>`;
}

const DOCUMENT_CSS = `
    @page { size: A4 portrait; margin: 12mm; }
    * { box-sizing: border-box; }
    html { background: #edf1ed; }
    body { margin: 0; color: #172b24; font: 9pt Arial, Helvetica, sans-serif; line-height: 1.3; }
    .membership-document { width: 210mm; max-width: 100%; margin: 0 auto; }
    .membership-part { min-height: 297mm; padding: 12mm; margin: 12px 0; background: white; border: 1px solid #d6dfd9; }
    .membership-heading { text-align: center; border-bottom: 2px solid #065845; padding-bottom: 3mm; margin-bottom: 3mm; }
    .membership-heading p { margin: 0 0 2mm; font-size: 9pt; }
    h1 { font-size: 14pt; color: #065845; margin: 1mm 0; line-height: 1.2; }
    .membership-subtitle { font-size: 12pt !important; font-weight: bold; }
    .membership-instruction { margin: 2mm 0 3mm; font-size: 8.5pt; }
    .membership-reference { display: flex; justify-content: space-between; gap: 5mm; font-size: 8.5pt; margin: 2mm 0; }
    .membership-reference span { overflow-wrap: anywhere; }
    h2 { font-size: 10pt; color: #065845; margin: 3mm 0 1mm; background: #eef5f1; padding: 1.5mm; border: 1px solid #bacbc0; break-after: avoid; }
    table { border-collapse: collapse; width: 100%; table-layout: fixed; font-size: 8.5pt; }
    thead { display: table-header-group; }
    tr { break-inside: avoid; }
    th, td { border: 1px solid #a3b4a9; padding: 1.4mm; text-align: left; vertical-align: top; overflow-wrap: anywhere; white-space: pre-wrap; }
    th { background: #f0f5f2; font-size: 8.5pt; font-weight: bold; }
    .membership-personal th { width: 23%; }
    .membership-personal td { width: 27%; }
    .membership-education th:first-child { width: 35%; }
    .membership-education th:nth-child(2) { width: 30%; }
    .membership-education th:nth-child(3) { width: 15%; }
    .membership-education th:nth-child(4) { width: 20%; }
    .membership-education th, .membership-education td { padding: 1mm; }
    .empty-records { color: #536b5e; padding: 3mm; font-style: italic; }
    .membership-academic-note { font-size: 8.5pt; margin: 2mm 0 0; }
    .membership-declaration { border: 1px solid #a3b4a9; padding: 4mm; margin-top: 5mm; break-inside: avoid; }
    .membership-declaration p { margin: 0 0 3mm; }
    .membership-declaration p:last-child { margin-bottom: 0; }
    .membership-committee { margin-top: 6mm; break-inside: avoid; }
    .membership-committee h2 { margin-top: 0; }
    .membership-committee p { font-size: 8.5pt; }
    .membership-committee .blank-lines { display: grid; grid-template-columns: 1fr 1fr; gap: 7mm; margin-top: 8mm; }
    .membership-committee .blank-line { border-top: 1px solid #62766a; padding-top: 2mm; font-size: 8.5pt; text-align: center; }
    .membership-footer { font-size: 8pt; color: #536b5e; margin-top: 6mm; text-align: center; }
    @media print {
        html { background: white; }
        body { margin: 0; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
        .membership-document { width: auto; max-width: none; margin: 0; }
        .membership-part { padding: 0; min-height: 0; margin: 0; border: 0; }
        .membership-part + .membership-part { break-before: page; }
    }
    @media screen and (max-width: 700px) {
        .membership-part { min-height: 0; padding: 16px; margin: 0; }
        .membership-reference { flex-wrap: wrap; }
        body { font-size: 9pt; }
        th, td { padding: 5px; }
    }
`;

function buildMembershipDocumentHtml(record) {
    const application = typeof record?.get === 'function' ? record.get({ plain: true }) : record;
    if (!application || typeof application !== 'object') throw new TypeError('A saved membership application is required.');
    const personal = structured(application.personal_details, {});
    const options = structured(application.options, {});
    const details = { ...personal, social_media_account: personal.social_media_account || personal.social_media,
        age: ageAtSubmission(personal.date_of_birth, application.submitted_at) };
    const personalRows = [];
    for (let index = 0; index < PERSONAL_FIELDS.length; index += 2) {
        const pairs = PERSONAL_FIELDS.slice(index, index + 2);
        personalRows.push(`<tr>${pairs.map(([label, key]) => `<th scope="row">${escapeHtml(label)}</th><td>${key === 'date_of_birth' && details[key] ? dateLabel(details[key]) : printable(details[key])}</td>`).join('')}${pairs.length === 1 ? '<th aria-hidden="true"></th><td></td>' : ''}</tr>`);
    }
    const savedEducation = structured(application.educational_attainment, []);
    const education = sectionTable('II. EDUCATIONAL ATTAINMENT', officialEducationRows(savedEducation), [
        { label: 'Education Level / School', render: row => `${printable(EDUCATION_LEVELS[row.level] || row.level)}<br>${printable(row.school_name)}` },
        { label: 'School Address', key: 'address' },
        { label: 'Year Graduated', key: 'year_graduated' }, { label: 'Honor / Awards', key: 'honors_awards' }
    ], 'No educational information provided.').replace('<table>', '<table class="membership-education">') + (!Array.isArray(savedEducation) || !savedEducation.length ? '<p class="membership-academic-note">No educational information provided.</p>' : '');
    const work = sectionTable('III. WORK EXPERIENCE', structured(application.work_experience, []), [
        { label: 'Date / Employment Period', key: 'employment_period' }, { label: 'Position', key: 'position' },
        { label: 'Agency / Employer', render: row => printable(row.agency_employer || row.employer) }, { label: 'Employment Status', key: 'employment_status' }
    ], options.no_work_experience ? 'No Work Experience' : 'No work experience information provided.');
    const training = sectionTable('IV. TRAINING / WORKSHOP / SEMINAR', structured(application.training_seminars, []), [
        { label: 'Title of Training / Workshop', key: 'title' }, { label: 'Date', key: 'date' },
        { label: 'Venue', key: 'venue' }, { label: 'Conducted / Facilitated By', key: 'facilitator' }
    ], options.no_training_seminars ? 'No training or seminar information applies.' : 'No training or seminar information provided.');
    const community = sectionTable('V. COMMUNITY INVOLVEMENT', structured(application.community_involvement, []), [
        { label: 'Date', key: 'date' }, { label: 'Organization / Association / Cooperative', key: 'organization' },
        { label: 'Designation / Position', render: row => printable(row.designation || row.position) }, { label: 'Years', key: 'years' }
    ], options.no_community_involvement ? 'No community involvement information applies.' : 'No community involvement information provided.');
    const awards = sectionTable('VI. AWARDS / CITATION RECEIVED', structured(application.awards_citations, []), [
        { label: 'Award / Citation Received', key: 'award' }, { label: 'Date', key: 'date' },
        { label: 'Place / Venue', key: 'venue' }, { label: 'Award Giving Body', key: 'awarding_body' }
    ], options.no_awards_citations ? 'No award or citation information applies.' : 'No award or citation information provided.');
    const title = ['DJEMC Membership Application', personal.first_name, personal.last_name].filter(Boolean).join(' — ');
    const accepted = application.consent_accepted === true || application.consent_accepted === 1;
    const academicSummary = application.graduation_year ? `<p class="membership-academic-note"><strong>Graduation year recorded at submission:</strong> Batch ${printable(application.graduation_year)}</p>` : '';
    const optionalName = value => /^(?:n\/?a|not applicable)$/i.test(String(value || '').trim()) ? '' : value;
    const recordedName = [personal.first_name, optionalName(personal.middle_name), personal.last_name, optionalName(personal.extension)].filter(Boolean).join(' ');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><style>${DOCUMENT_CSS}</style></head><body><main class="membership-document" data-membership-application-id="${escapeHtml(application.id)}"><article class="membership-part"><header class="membership-heading"><h1>DON JOSE ECLEO MEMORIAL COLLEGE<br>ALUMNI ASSOCIATION</h1><p>P-5 Justiniana Edera, San Jose, Dinagat Islands</p><p class="membership-subtitle">MEMBERSHIP APPLICATION FORM</p></header><div class="membership-reference"><span><strong>Application:</strong> ${printable(application.id)}</span><span><strong>Date Submitted:</strong> ${dateLabel(application.submitted_at, true)}</span><span><strong>Status:</strong> ${printable(application.application_status)}</span></div><p class="membership-instruction">Please complete all sections of this form accurately and honestly. Ensure that the information you provide is correct. If a field does not apply to you, please indicate N/A. Your responses will remain confidential and will be used solely for the stated purpose.</p><section class="membership-section"><h2>I. PERSONAL DETAILS</h2><table class="membership-personal"><tbody>${personalRows.join('')}</tbody></table></section>${education}${academicSummary}${work}</article><article class="membership-part">${training}${community}${awards}<section class="membership-declaration"><p><strong>DECLARATION AND CONSENT</strong></p><p>${escapeHtml(application.consent_text || DECLARATION)}</p><p><strong>Consent acknowledgement:</strong> ${accepted ? 'Accepted electronically' : 'Not recorded'}<br><strong>Accepted on:</strong> ${dateLabel(application.consent_accepted_at, true)}<br><strong>Consent version:</strong> ${printable(application.consent_version)}</p><p><strong>Applicant name recorded electronically:</strong> ${printable(recordedName)}</p><p>Submission records an application and does not constitute association membership approval.</p></section><section class="membership-committee"><p><strong>Conformed:</strong></p><div class="blank-lines"><div class="blank-line">Signature Over-Printed Name</div><div></div></div><h2>FOR ASSOCIATION USE ONLY</h2><p>Committee approval fields are reserved for authorized association personnel.</p><table aria-label="Blank association approval fields"><tbody><tr><th scope="row">Approved during BOT Meeting on:</th><td></td><th scope="row">Resolution No.:</th><td></td></tr><tr><th scope="row">Checked:<br>Committee on Membership</th><td></td><th scope="row">Verified:</th><td></td></tr><tr><th scope="row">Attested:</th><td></td><th scope="row">Approved:</th><td></td></tr></tbody></table></section><footer class="membership-footer">Confidential membership application · DJEMC Alumni Association</footer></article></main></body></html>`;
}

module.exports = { buildMembershipDocumentHtml, escapeHtml, ageAtSubmission, PERSONAL_FIELDS };
