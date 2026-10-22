const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../models');
const controller = require('../controllers/resumeController');
const persistence = require('../services/resumePersistence');
const pdf = require('../services/resumePdf');
const { Op } = require('sequelize');

const response = () => ({ statusCode: 200, headers: {}, status(code) { this.statusCode = code; return this; },
    json(body) { this.body = JSON.parse(JSON.stringify(body)); return this; }, setHeader(key, value) { this.headers[key] = value; }, send(body) { this.body = body; return this; } });
const request = (body = {}, id = '1', userId = 7) => ({ body, params: { id }, user: { id: userId } });
const complete = () => ({ title: 'Resume', template_id: 'creative-professional', settings: { client_draft_id: 'draft-123' }, is_default: true,
    personalInfo: { full_name: 'Alex', email: 'alex@example.com', github: 'github.com/alex', portfolio: 'example.com', photo_url: 'data:image/png;base64,abcd' }, summary: { content: 'Summary' },
    education: [{ institution: 'DJEMC', degree: 'BSIT', gpa: '1.5', is_current: true, start_date: '2024-08-01' }], workExperience: [{ company: 'Office', job_title: 'Assistant', is_current: true }],
    skills: [{ skill_name: 'React', category: 'Technical' }], projects: [{ project_name: 'Portal', technologies: 'React', is_current: true }],
    certifications: [{ name: 'Certificate', issue_date: '2024-01-01', expiry_date: '2027-01-01', credential_id: 'ABC' }], trainings: [{ training_name: 'Training', completion_date: '2024-02-01' }],
    seminars: [{ seminar_name: 'Seminar', location: 'Manila', date: '2024-03-01' }], awards: [{ title: 'Award', description: 'Description' }],
    organizations: [{ organization_name: 'Association', position: 'Chair', is_current: true }], volunteerWork: [{ organization: 'Community', role: 'Volunteer', is_current: true }],
    languages: [{ language: 'Filipino', proficiency: 'Native' }], references: [{ name: 'Maria', relationship: 'Supervisor', email: 'maria@example.com' }] });

async function fixture(run, failSection) {
    let state = { resumes: [], sections: {} };
    let committed = 0;
    let rolledBack = 0;
    const backups = [];
    const override = (target, changes) => { backups.push([target, Object.fromEntries(Object.keys(changes).map(key => [key, target[key]]))]); Object.assign(target, changes); };
    const match = (record, where = {}) => Object.entries(where).every(([key, value]) => {
        if (value && typeof value === 'object' && value[Op.ne] !== undefined) return String(record[key]) !== String(value[Op.ne]);
        return String(record[key]) === String(value);
    });
    const row = (record) => ({ ...record, toJSON: () => ({ ...record }), update: async (fields, options) => {
        assert.ok(options.transaction); Object.assign(record, fields); return row(record);
    } });
    override(db.sequelize, { transaction: async runInTransaction => {
        const previous = structuredClone(state);
        const transaction = { LOCK: { UPDATE: 'UPDATE' } };
        try { const result = await runInTransaction(transaction); committed += 1; return result; }
        catch (error) { state = previous; rolledBack += 1; throw error; }
    } });
    override(db.User, { findByPk: async (id, options) => {
        assert.ok(options.transaction); return { id, name: 'Prefilled Graduate', email: 'prefill@example.com', AlumniProfile: { address: 'City', avatar_url: '/uploads/photo.jpg' } };
    } });
    override(db.Resume, {
        create: async (fields, options) => { assert.ok(options.transaction); const record = { id: state.resumes.length + 1, ...fields }; state.resumes.push(record); return row(record); },
        findOne: async options => { const record = state.resumes.find(record => match(record, options.where)); return record ? row(record) : null; },
        findAll: async options => state.resumes.filter(record => match(record, options.where)).map(row),
        update: async (fields, options) => { assert.ok(options.transaction); state.resumes.filter(record => match(record, options.where)).forEach(record => Object.assign(record, fields)); }
    });
    for (const [name, definition] of Object.entries(persistence.sections)) {
        const Model = db[definition.model];
        const sectionRecords = () => state.sections[name] || (state.sections[name] = []);
        override(Model, {
            findOne: async options => { const record = sectionRecords().find(record => match(record, options.where)); return record ? row(record) : null; },
            findAll: async options => sectionRecords().filter(record => match(record, options.where)).map(row),
            create: async (fields, options) => { assert.ok(options.transaction); if (name === failSection) throw new Error('Simulated section failure'); sectionRecords().push({ ...fields }); return row(fields); },
            destroy: async options => { assert.ok(options.transaction); state.sections[name] = sectionRecords().filter(record => !match(record, options.where)); },
            bulkCreate: async (records, options) => { assert.ok(options.transaction); if (name === failSection) throw new Error('Simulated section failure'); sectionRecords().push(...records.map(record => ({ ...record }))); }
        });
    }
    try { await run({ state: () => state, commits: () => committed, rollbacks: () => rolledBack }); }
    finally { for (const [target, changes] of backups.reverse()) Object.assign(target, changes); }
}
test.after(async () => { await db.sequelize.close(); });

test('creation persists all fourteen section models in one transaction', async () => {
    await fixture(async context => {
        const res = response(); await controller.createResume(request(complete()), res);
        assert.equal(res.statusCode, 201); assert.equal(context.commits(), 1);
        assert.equal(context.state().resumes.length, 1);
        for (const key of Object.keys(persistence.sections)) assert.equal(context.state().sections[key].length, 1, key);
        assert.equal(context.state().sections.education[0].institution, 'DJEMC');
        assert.equal(context.state().sections.projects[0].technologies, 'React');
        assert.equal(context.state().sections.languages[0].language, 'Filipino');
        assert.equal(context.state().sections.personalInfo[0].github, 'github.com/alex');
    });
});

test('a retried create with the same draft key returns the same record without duplicating sections', async () => {
    await fixture(async context => {
        const first = response(); const retried = response();
        await controller.createResume(request(complete()), first);
        await controller.createResume(request(complete()), retried);
        assert.equal(retried.statusCode, 200); assert.equal(retried.body.data.id, first.body.data.id);
        assert.equal(retried.body.reused, true); assert.equal(first.body.reused, false);
        assert.equal(context.state().resumes.length, 1); assert.equal(context.state().sections.skills.length, 1);
        await controller.createResume(request(complete(), '1', 8), response());
        assert.equal(context.state().resumes.length, 2, 'Draft identifiers are scoped to each owner');
    });
});

test('updates preserve fields and replace only submitted sections on the same resume', async () => {
    await fixture(async context => {
        await controller.createResume(request(complete()), response());
        const res = response();
        await controller.updateResume(request({ title: 'Edited', projects: [{ project_name: 'Changed', technologies: 'Node' }], personalInfo: { photo_url: null } }), res);
        assert.equal(res.statusCode, 200); assert.equal(context.state().resumes.length, 1);
        assert.equal(context.state().sections.projects[0].project_name, 'Changed');
        assert.equal(context.state().sections.personalInfo[0].full_name, 'Alex');
        assert.equal(context.state().sections.personalInfo[0].photo_url, null);
        assert.equal(context.state().sections.certifications[0].credential_id, 'ABC');
        const detail = response(); await controller.getResume(request(), detail);
        assert.equal(detail.body.template_id, 'creative-professional');
        assert.equal(detail.body.languages[0].language, 'Filipino');
    });
});

test('section failure rolls back creation so no empty resume is left behind', async () => {
    await fixture(async context => {
        const res = response(); await controller.createResume(request(complete()), res);
        assert.equal(res.statusCode, 500); assert.equal(context.rollbacks(), 1);
        assert.deepEqual(context.state(), { resumes: [], sections: {} });
    }, 'projects');
});

test('section failure rolls back both header and section changes in updates', async () => {
    await fixture(async context => {
        await controller.createResume(request({ title: 'Before', personalInfo: { full_name: 'Alex' }, skills: [{ skill_name: 'Before' }] }), response());
        const before = structuredClone(context.state()); const res = response();
        await controller.updateResume(request({ title: 'After', skills: [{ skill_name: 'After' }], projects: [{ project_name: 'Fails' }] }), res);
        assert.equal(res.statusCode, 500); assert.deepEqual(context.state(), before);
    }, 'projects');
});

test('invalid lists and malformed draft keys are rejected before saving', async () => {
    await fixture(async context => {
        for (const body of [{ languages: {} }, { projects: [null] }, { settings: { client_draft_id: '../unsafe' } }, { font_size: 90 }, { personalInfo: { photo_url: 'blob:temporary' } }]) {
            const res = response(); await controller.createResume(request(body), res); assert.equal(res.statusCode, 400);
        }
        assert.equal(context.state().resumes.length, 0);
    });
});

test('omitted personal information still uses the existing profile prefill', async () => {
    await fixture(async context => {
        const res = response(); await controller.createResume(request({ title: 'Prefilled' }), res);
        assert.equal(res.statusCode, 201); assert.equal(context.state().sections.personalInfo[0].full_name, 'Prefilled Graduate');
    });
});

test('one default per owner is maintained without changing another owner', async () => {
    await fixture(async context => {
        await controller.createResume(request({ title: 'First', is_default: true }), response());
        await controller.createResume(request({ title: 'Other owner', is_default: true }, '1', 8), response());
        await controller.createResume(request({ title: 'Second', is_default: true }), response());
        assert.deepEqual(context.state().resumes.map(record => record.is_default), [false, true, true]);
    });
});

test('duplication copies one-to-one and list sections without copying identity or draft key', async () => {
    await fixture(async context => {
        await controller.createResume(request(complete()), response());
        const res = response(); await controller.duplicateResume(request(), res);
        assert.equal(res.statusCode, 201); assert.equal(context.state().resumes.length, 2);
        assert.equal(res.body.data.template_id, 'creative-professional'); assert.equal(res.body.data.settings.client_draft_id, undefined);
        for (const key of Object.keys(persistence.sections)) assert.equal(context.state().sections[key].filter(item => item.resume_id === 2).length, 1, key);
        assert.equal(context.state().sections.references[1].relationship, 'Supervisor');
    });
});

test('another owner cannot read, update, duplicate or export this resume', async () => {
    await fixture(async context => {
        await controller.createResume(request(complete()), response());
        for (const method of [controller.getResume, controller.updateResume, controller.duplicateResume, controller.exportResumePdf]) {
            const res = response(); await method(request({ title: 'Unauthorized' }, '1', 8), res); assert.equal(res.statusCode, 404);
        }
        assert.equal(context.state().resumes.length, 1); assert.equal(context.state().resumes[0].title, 'Resume');
    });
});

test('legacy aliases map to real schema columns and cannot overwrite record identities', () => {
    const normalized = persistence.normalizeSections({ education: [{ school: 'Legacy', current: true, id: 99, resume_id: 999 }], projects: [{ name: 'Project' }], languages: [{ name: 'English' }], organizations: [{ name: 'Association', role: 'Chair' }], references: [{ name: 'Maria', position: 'Mentor' }] });
    assert.equal(normalized.education[0].institution, 'Legacy'); assert.equal(normalized.education[0].is_current, true);
    assert.equal(normalized.education[0].id, undefined); assert.equal(normalized.education[0].resume_id, undefined);
    assert.equal(normalized.organizations[0].position, 'Chair'); assert.equal(normalized.references[0].relationship, 'Mentor');
});

test('PDF export confirms saved owner/template and returns a PDF attachment', async () => {
    await fixture(async () => {
        await controller.createResume(request(complete()), response());
        const original = pdf.renderResumePdf;
        pdf.renderResumePdf = async () => Buffer.from('%PDF-1.7\nsample');
        try {
            const html = '<article class="djemc-resume-page" data-resume-id="1" data-template-id="creative-professional">Resume</article>';
            const res = response(); await controller.exportResumePdf(request({ html, template_id: 'creative-professional' }), res);
            assert.equal(res.statusCode, 200); assert.equal(res.headers['Content-Type'], 'application/pdf'); assert.equal(res.headers['Cache-Control'], 'private, no-store');
            assert.ok(res.body.toString().startsWith('%PDF'));
            const mismatch = response(); await controller.exportResumePdf(request({ html, template_id: 'minimal-black-white' }), mismatch); assert.equal(mismatch.statusCode, 409);
        } finally { pdf.renderResumePdf = original; }
    });
});

test('PDF policy rejects oversized/untrusted markup and blocks remote or filesystem resources', () => {
    const html = '<article class="djemc-resume-page" data-resume-id="1" data-template-id="modern-professional">Resume</article>';
    assert.doesNotThrow(() => pdf.validateResumeHtml(html, 1, 'modern-professional'));
    for (const prefix of ['<script>bad</script>', '<iframe src="file:///secret"></iframe>', '<object></object>', '<meta http-equiv="refresh">']) assert.throws(() => pdf.validateResumeHtml(prefix + html, 1, 'modern-professional'), /unsupported/);
    assert.throws(() => pdf.validateResumeHtml('x'.repeat(2 * 1024 * 1024 + 1), 1, 'modern-professional'), /too large/);
    assert.throws(() => pdf.validateResumeHtml(html, 2, 'modern-professional'), /Save this resume/);
    assert.equal(pdf.isAllowedResource('data:image/png;base64,aGVsbG8='), true);
    for (const url of ['http://localhost:5000/api/profile', 'https://example.com/image.png', 'file:///C:/secret', 'data:text/html;base64,abcd', 'data:image/svg+xml;base64,abcd']) assert.equal(pdf.isAllowedResource(url), false);
});

test('categories and all seven programming skills survive create, reload, recategorize, rename, remove and duplicate', async () => {
    await fixture(async context => {
        const resume = complete();
        const names = ['Node.js', 'JavaScript', 'CSS', 'HTML', 'React', 'Vite', 'MySQL'];
        resume.skills = [...names.map(skill_name => ({ skill_name, category: 'Programming' })), { skill_name: 'Problem solving', category: null }, { skill_name: 'Git', category: 'Tools' }];
        resume.settings.skill_categories = ['Programming', 'Tools', 'Empty Category'];
        const created = response(); await controller.createResume(request(resume), created);
        assert.equal(created.statusCode, 201);
        const loaded = response(); await controller.getResume(request(), loaded);
        assert.deepEqual(loaded.body.skills.slice(0, 7).map(skill => [skill.skill_name, skill.category]), names.map(name => [name, 'Programming']));
        assert.deepEqual(loaded.body.settings.skill_categories, ['Programming', 'Tools', 'Empty Category']);
        const edited = loaded.body.skills.map(skill => skill.skill_name === 'MySQL' ? { ...skill, category: 'Database Management' } : skill.category === 'Tools' ? { ...skill, category: 'Tools and Technologies' } : skill);
        const updated = response(); await controller.updateResume(request({ skills: edited, settings: { ...resume.settings, skill_categories: ['Programming', 'Database Management', 'Tools and Technologies', 'Empty Category'] } }), updated);
        assert.equal(updated.statusCode, 200);
        const reloaded = response(); await controller.getResume(request(), reloaded);
        assert.equal(reloaded.body.skills.find(skill => skill.skill_name === 'MySQL').category, 'Database Management');
        assert.equal(reloaded.body.skills.find(skill => skill.skill_name === 'Git').category, 'Tools and Technologies');
        assert.equal(reloaded.body.skills.find(skill => skill.skill_name === 'Problem solving').category, null);
        assert.equal(reloaded.body.summary.content, 'Summary');
        assert.equal(reloaded.body.education[0].institution, 'DJEMC');
        const copy = response(); await controller.duplicateResume(request(), copy);
        assert.equal(copy.statusCode, 201);
        const copied = response(); await controller.getResume(request({}, String(copy.body.data.id)), copied);
        assert.deepEqual(copied.body.skills.map(skill => [skill.skill_name, skill.category]), reloaded.body.skills.map(skill => [skill.skill_name, skill.category]));
        assert.deepEqual(copied.body.settings.skill_categories, reloaded.body.settings.skill_categories);
        // Removing a category changes assignments only, retaining its skills.
        const ungrouped = reloaded.body.skills.map(skill => skill.category === 'Programming' ? { ...skill, category: null } : skill);
        await controller.updateResume(request({ skills: ungrouped, settings: { ...reloaded.body.settings, skill_categories: reloaded.body.settings.skill_categories.filter(name => name !== 'Programming') } }), response());
        assert.equal(context.state().sections.skills.filter(skill => String(skill.resume_id) === '1').length, 9);
        await controller.updateResume(request({ skills: ungrouped.filter(skill => skill.skill_name !== 'Git') }), response());
        assert.equal(context.state().sections.skills.filter(skill => String(skill.resume_id) === '1').length, 8);
        assert.equal(context.state().sections.summary.find(item => item.resume_id === 1).content, 'Summary');
    });
});

test('invalid/empty skills, category names and duplicates fail before writes and preserve the saved resume', async () => {
    await fixture(async context => {
        await controller.createResume(request(complete()), response());
        const before = structuredClone(context.state());
        const invalid = [
            { skills: [{ skill_name: ' ' }] }, { skills: [{ category: 'Programming' }] },
            { skills: [{ skill_name: 42 }] }, { skills: [{ skill_name: 'x'.repeat(256) }] },
            { skills: [{ skill_name: 'React', category: {} }] }, { skills: [{ skill_name: 'React', category: 'x'.repeat(101) }] },
            { skills: [{ skill_name: 'React', category: 'Programming' }, { skill_name: ' react ', category: ' programming ' }] },
            { skills: [{ skill_name: 'React', category: null }, { skill_name: 'react', category: 'Uncategorized' }] },
            ...['bad', [''], ['  '], [42], ['x'.repeat(101)], ['Programming', ' programming ']].map(skill_categories => ({ settings: { skill_categories } }))
        ];
        for (const body of invalid) {
            const res = response(); await controller.updateResume(request(body), res);
            assert.equal(res.statusCode, 400, JSON.stringify(body));
            assert.deepEqual(context.state(), before, 'Invalid edits must not delete or replace saved sections');
        }
        const valid = persistence.normalizeSections({ skills: [{ name: ' React ', category: ' Programming ' }, { skill_name: 'React', category: 'Tools' }, { skill_name: 'Legacy' }, { skill_name: 'Other legacy', category: null }] });
        assert.equal(valid.skills[0].skill_name, 'React');
        assert.equal(valid.skills[0].category, 'Programming');
        assert.equal(valid.skills[2].category, undefined);
        assert.equal(valid.skills[3].category, null);
        assert.equal(db.ResumeSkill.getTableName(), 'resumeskills');
        assert.equal(db.ResumeSkill.rawAttributes.category.type.options.length, 100);
    });
});
