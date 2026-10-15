// Exercise the configured database without committing test records or changing existing resumes.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const db = require('../models');
const controller = require('../controllers/resumeController');
const { readSections } = require('../services/resumePersistence');
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = JSON.parse(JSON.stringify(body)); return this; } });

(async () => {
    let transaction;
    const originalTransaction = db.sequelize.transaction.bind(db.sequelize);
    try {
        await db.sequelize.authenticate();
        const owner = await db.User.findOne({ where: { role: 'alumni' }, attributes: ['id'] });
        if (!owner) throw new Error('No existing alumni account is available for this rollback-only check.');
        const initialCount = await db.Resume.count();
        transaction = await originalTransaction();
        db.sequelize.transaction = async run => run(transaction);
        const body = {
            title: 'Resume regression check (rolled back)', template_id: 'creative-professional', is_default: false,
            settings: { client_draft_id: `check-${crypto.randomUUID()}` },
            personalInfo: { full_name: 'Resume Regression Fixture', email: 'fixture@example.invalid', photo_url: 'data:image/png;base64,iVBORw0KGgo=' },
            summary: { content: 'Summary fixture' }, education: [{ institution: 'DJEMC', degree: 'BSIT', gpa: '1.5', is_current: true, start_date: '2022-08-01' }],
            workExperience: [{ job_title: 'Developer', company: 'Fixture Company', is_current: true }], skills: [{ skill_name: 'React' }],
            projects: [{ project_name: 'Fixture Project', technologies: 'React, Node.js', is_current: true }], certifications: [{ name: 'Fixture Certification', issue_date: '2025-01-01', credential_id: 'ABC123' }],
            trainings: [{ training_name: 'Fixture Training', completion_date: '2025-02-01' }], seminars: [{ seminar_name: 'Fixture Seminar', location: 'Manila', date: '2025-03-01' }],
            awards: [{ title: 'Fixture Award', description: 'Award description' }], organizations: [{ organization_name: 'Fixture Association', position: 'Chair' }],
            volunteerWork: [{ organization: 'Fixture Community', role: 'Volunteer', is_current: true }], languages: [{ language: 'Filipino', proficiency: 'Native' }], references: [{ name: 'Fixture Reference', relationship: 'Supervisor' }]
        };
        const req = (payload, id, userId = owner.id) => ({ user: { id: userId }, params: { id: String(id || '') }, body: payload });
        const created = response(); await controller.createResume(req(body), created); assert.equal(created.statusCode, 201);
        const id = created.body.data.id;
        const repeated = response(); await controller.createResume(req(body), repeated); assert.equal(repeated.body.data.id, id); assert.equal(repeated.statusCode, 200);
        const loaded = await readSections(id, transaction);
        assert.equal(Object.keys(loaded).length, 14);
        assert.equal(loaded.education[0].institution, 'DJEMC'); assert.equal(loaded.education[0].gpa, '1.5');
        assert.equal(loaded.projects[0].technologies, 'React, Node.js'); assert.equal(loaded.languages[0].language, 'Filipino');
        const updated = response(); await controller.updateResume(req({ template_id: 'minimal-black-white', personalInfo: { photo_url: null }, projects: [{ project_name: 'Updated Fixture', technologies: 'Node.js' }] }, id), updated); assert.equal(updated.statusCode, 200);
        const reloaded = await readSections(id, transaction);
        assert.equal(reloaded.personalInfo.full_name, 'Resume Regression Fixture'); assert.equal(reloaded.personalInfo.photo_url, null);
        assert.equal(reloaded.projects[0].project_name, 'Updated Fixture'); assert.equal(reloaded.certifications[0].credential_id, 'ABC123');
        const duplicated = response(); await controller.duplicateResume(req({}, id), duplicated); assert.equal(duplicated.statusCode, 201);
        const copy = await readSections(duplicated.body.data.id, transaction); assert.equal(copy.references[0].relationship, 'Supervisor');
        assert.equal(duplicated.body.data.settings.client_draft_id, undefined);
        assert.equal(await db.Resume.count({ transaction }), initialCount + 2);
        console.log('PASS: configured MariaDB creation, all 14 sections, idempotent retry, update, photo removal, reload, template persistence and duplication.');
        await transaction.rollback(); transaction = null;
        assert.equal(await db.Resume.count(), initialCount);
        console.log(`PASS: rollback confirmed; existing resume count remains ${initialCount}. No test records were committed.`);
    } finally {
        db.sequelize.transaction = originalTransaction;
        if (transaction && !transaction.finished) await transaction.rollback();
        await db.sequelize.close();
    }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
