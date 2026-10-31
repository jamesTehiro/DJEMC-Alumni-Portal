import test from 'node:test';
import assert from 'node:assert/strict';
import { jobPostingFormFromJob, jobPostingUpdatePayload, requirementsFromJob } from '../src/features/jobs/utils/jobPostingEdit.js';
import { validateJobPosting } from '../src/features/jobs/utils/jobPosting.js';

const saved = () => ({ id: 44, employer_id: 18, title: 'Saved title', description: 'Original description', location: 'Cebu', employment_type: 'Part-Time', expected_salary: 'Original salary', recruitment_status: 'closed', approval_status: 'approved', posting_details: { work_setup: 'remote', vacancy_count: 2, responsibilities: ['Support customers'], required_qualifications: { education: 'BSIT', skills: ['JavaScript'] }, application: { instructions: 'Use the portal', publish_contact: true, contact_email: 'jobs@example.invalid' }, compensation: { min: 100, max: 200, display: 'range', period: 'daily' }, benefits: { government: ['SSS'] } }, requirement_groups: [{ id: 9, group_label: 'Identity', sort_order: 0 }], requirements: [{ id: 3, requirement_code: 'custom_portfolio', label: 'Portfolio', description: 'Original instructions', group_id: 9, requirement_type: 'document_upload', value_type: 'file', required: true, is_custom: true, allowed_types: 'pdf', max_file_size: 2048, sort_order: 0, value_options: ['Preserved'], condition_enabled: true, condition_field: 'experience', condition_operator: 'equals', condition_value: 'yes' }] });

test('edit draft prefills saved fields, merges missing nested defaults and detaches arrays', () => {
    const job = saved(), form = jobPostingFormFromJob(job);
    assert.equal(form.title, job.title); assert.equal(form.location, 'Cebu'); assert.equal(form.employment_type, 'part-time');
    assert.equal(form.posting_details.work_setup, 'remote'); assert.equal(form.posting_details.vacancy_count, 2);
    assert.equal(form.posting_details.required_qualifications.education, 'BSIT');
    assert.equal(form.posting_details.application.contact_email, 'jobs@example.invalid');
    assert.deepEqual(form.posting_details.required_qualifications.other, []);
    form.posting_details.responsibilities.push('New');
    assert.deepEqual(job.posting_details.responsibilities, ['Support customers']);
    const requirements = requirementsFromJob(job); requirements[0].label = 'Changed'; assert.equal(job.requirements[0].label, 'Portfolio');
});

test('legacy jobs prefill their existing fields without requiring previously absent requirements', () => {
    const job = { title: 'Legacy', description: 'Legacy description', location: 'Dinagat', employment_type: 'Full-Time', posting_details: null };
    const form = jobPostingFormFromJob(job);
    assert.equal(form.description, 'Legacy description'); assert.equal(form.posting_details.application.instructions, '');
    assert.deepEqual(validateJobPosting(form, [], { allowEmptyRequirements: true }), []);
    assert.ok(validateJobPosting(form, []).some(error => /at least one/.test(error)));
    assert.equal(jobPostingFormFromJob({ ...job, posting_details: JSON.stringify(saved().posting_details) }).posting_details.work_setup, 'remote');
});

test('text edits omit unchanged requirements, workflow controls and hidden salary/benefit fields', () => {
    const job = saved(), form = jobPostingFormFromJob(job); form.title = 'Corrected';
    const payload = jobPostingUpdatePayload(form, requirementsFromJob(job), job);
    assert.equal(payload.title, 'Corrected');
    for (const key of ['id', 'employer_id', 'recruitment_status', 'approval_status', 'createdAt', 'interview_details', 'expected_salary', 'requirements', 'groups']) assert.equal(Object.hasOwn(payload, key), false, key);
    assert.equal(Object.hasOwn(payload.posting_details, 'compensation'), false);
    assert.equal(Object.hasOwn(payload.posting_details, 'benefits'), false);
    assert.equal(payload.posting_details.application.contact_email, 'jobs@example.invalid');
});

test('requirement edits retain metadata and map existing groups into the next version', () => {
    const job = saved(), items = requirementsFromJob(job); items[0].label = 'Updated portfolio';
    const payload = jobPostingUpdatePayload(jobPostingFormFromJob(job), items, job);
    const requirement = payload.requirements[0];
    for (const key of ['description', 'requirement_code', 'allowed_types', 'max_file_size', 'value_options', 'condition_enabled', 'condition_field', 'condition_operator', 'condition_value']) assert.deepEqual(requirement[key], job.requirements[0][key], key);
    assert.equal(requirement.group_temp_id, 'group_9'); assert.equal(requirement.id, undefined);
    assert.deepEqual(payload.groups, [{ tempId: 'group_9', label: 'Identity', sort_order: 0 }]);
    assert.deepEqual(jobPostingUpdatePayload(jobPostingFormFromJob(job), [], job).requirements, []);
});

test('edit validation still rejects missing required text, invalid dates and duplicate requirement identifiers', () => {
    const job = saved(), form = jobPostingFormFromJob(job); form.title = ''; form.posting_details.application.deadline = '2026-02-30';
    const errors = validateJobPosting(form, [...job.requirements, ...job.requirements], { allowEmptyRequirements: true });
    for (const text of ['Job Title', 'valid date', 'unique identifiers']) assert.ok(errors.some(error => error.includes(text)));
});
