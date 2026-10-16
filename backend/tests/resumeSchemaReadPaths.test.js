const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../models');
const controller = require('../controllers/resumeController');
const routes = require('../routes/resumeRoutes');

const sections = [
    ['personalInfo', 'ResumePersonalInfo', 'resumepersonalinfo', 'HasOne'],
    ['summary', 'ResumeSummary', 'resumesummaries', 'HasOne'],
    ['education', 'ResumeEducation', 'resumeeducations', 'HasMany'],
    ['workExperience', 'ResumeWorkExperience', 'resumeworkexperiences', 'HasMany'],
    ['skills', 'ResumeSkill', 'resumeskills', 'HasMany'],
    ['projects', 'ResumeProject', 'resumeprojects', 'HasMany'],
    ['certifications', 'ResumeCertification', 'resumecertifications', 'HasMany'],
    ['trainings', 'ResumeTraining', 'resumetrainings', 'HasMany'],
    ['seminars', 'ResumeSeminar', 'resumeseminars', 'HasMany'],
    ['awards', 'ResumeAward', 'resumeawards', 'HasMany'],
    ['organizations', 'ResumeOrganization', 'resumeorganizations', 'HasMany'],
    ['volunteerWork', 'ResumeVolunteerWork', 'resumevolunteerworks', 'HasMany'],
    ['languages', 'ResumeLanguage', 'resumelanguages', 'HasMany'],
    ['references', 'ResumeReference', 'resumereferences', 'HasMany']
];
const children = [...sections, ['versions', 'ResumeVersion', 'resumeversions', 'HasMany']];
const response = () => ({
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = JSON.parse(JSON.stringify(value)); return this; }
});
const request = () => ({ user: { id: 7 }, params: { id: '41' }, body: {} });
const routeHandler = (path) => routes.stack.find(layer => layer.route?.path === path && layer.route.methods.get).route.stack.at(-1).handle;

// Exercise Sequelize's real model/query-generator path, intercepting its final SQL
// boundary so these regressions require neither a database nor fixture writes.
async function captureReads(run, owned = true) {
    const original = db.sequelize.query;
    const queries = [];
    db.sequelize.query = async (sql, options) => {
        assert.equal(options.type, db.Sequelize.QueryTypes.SELECT, 'read handlers must only issue SELECTs');
        queries.push({ sql, model: options.model.name });
        const Model = options.model;
        let row;
        if (Model === db.Resume) {
            row = owned ? Model.build({ id: 41, user_id: 7, title: 'Schema fixture', is_archived: false }, { isNewRecord: false }) : null;
        } else if (Model === db.ResumePersonalInfo) {
            row = Model.build({ id: 42, resume_id: 41, full_name: 'Fixture Graduate' }, { isNewRecord: false });
        } else if (Model === db.ResumeVersion) {
            row = Model.build({ id: 43, resume_id: 41, version_number: 1, snapshot_data: {} }, { isNewRecord: false });
        } else {
            row = Model.build({ id: 44, resume_id: 41 }, { isNewRecord: false });
        }
        return options.plain ? row : row ? [row] : [];
    };
    try { await run(queries); }
    finally { db.sequelize.query = original; }
}

function assertRead(query, model, table) {
    assert.equal(query.model, model);
    assert.ok(query.sql.includes('FROM `' + table + '` AS `' + model + '`'), query.sql);
    assert.match(query.sql, /`createdAt`/);
    assert.match(query.sql, /`updatedAt`/);
    assert.doesNotMatch(query.sql, /`created_at`|`updated_at`|email_queue_jobs/);
}

test.after(() => db.sequelize.close());

test('resume sections retain their registered aliases, foreign keys and camelCase timestamps', () => {
    assert.equal(db.Resume.getTableName(), 'resumes');
    assert.equal(db.Resume.associations.User.foreignKey, 'user_id');
    assert.equal(db.Resume.rawAttributes.user_id.references.model, 'users');
    assert.deepEqual(Object.keys(db.Resume.associations).sort(), ['User', ...children.map(([alias]) => alias)].sort());
    for (const [alias, name, table, type] of children) {
        const Model = db[name];
        const association = db.Resume.associations[alias];
        assert.equal(Model.getTableName(), table, name);
        assert.equal(association.target, Model, alias);
        assert.equal(association.associationType, type, alias);
        assert.equal(association.foreignKey, 'resume_id', alias);
        assert.equal(Model.associations.Resume.target, db.Resume, name);
        assert.equal(Model.associations.Resume.foreignKey, 'resume_id', name);
        assert.equal(Model.rawAttributes.resume_id.references.model, 'resumes', name);
        assert.equal(Model.rawAttributes.resume_id.references.key, 'id', name);
    }
    for (const Model of [db.Resume, ...children.map(([, name]) => db[name])]) {
        assert.equal(Model.sequelize, db.sequelize, Model.name);
        assert.equal(Model.options.timestamps, true, Model.name);
        assert.equal(Model.rawAttributes.createdAt.field, 'createdAt', Model.name);
        assert.equal(Model.rawAttributes.updatedAt.field, 'updatedAt', Model.name);
        assert.equal(Model.rawAttributes.created_at, undefined, Model.name);
        assert.equal(Model.rawAttributes.updated_at, undefined, Model.name);
    }
});

test('the resume-list handler reads only lowercase resumes and personal information for the current owner', async () => {
    assert.equal(routeHandler('/'), controller.getResumes);
    await captureReads(async queries => {
        const res = response();
        await routeHandler('/')(request(), res);
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.data[0].id, 41);
        assert.equal(res.body.data[0].personalInfo.full_name, 'Fixture Graduate');
        assert.equal(queries.length, 2);
        assertRead(queries[0], 'Resume', 'resumes');
        assertRead(queries[1], 'ResumePersonalInfo', 'resumepersonalinfo');
        assert.match(queries[0].sql, /`Resume`\.`user_id` = 7/);
        assert.match(queries[0].sql, /`Resume`\.`is_archived` = false/);
        assert.match(queries[1].sql, /`ResumePersonalInfo`\.`resume_id` = 41/);
    });
});

for (const [path, method] of [['/:id', 'getResume'], ['/:id/pdf', 'getResumePdf']]) {
    test(`${method} reads every section from its lowercase table with the selected resume foreign key`, async () => {
        assert.equal(routeHandler(path), controller[method]);
        await captureReads(async queries => {
            const res = response();
            await routeHandler(path)(request(), res);
            assert.equal(res.statusCode, 200);
            const data = method === 'getResumePdf' ? res.body.data : res.body;
            assert.equal((data.resume || data).id, 41);
            assert.equal(data.personalInfo.full_name, 'Fixture Graduate');
            assert.equal(queries.length, 15);
            assertRead(queries[0], 'Resume', 'resumes');
            assert.match(queries[0].sql, /`Resume`\.`user_id` = 7/);
            assert.match(queries[0].sql, /`Resume`\.`id` = '41'/);
            for (const [, name, table] of sections) {
                const query = queries.find(entry => entry.model === name);
                assert.ok(query, name);
                assertRead(query, name, table);
                assert.ok(query.sql.includes('`' + name + "`.`resume_id` = '41'"), query.sql);
            }
        });
    });
}

test('versions are read from lowercase resumeversions after checking the owning resume', async () => {
    assert.equal(routeHandler('/:id/versions'), controller.getVersions);
    await captureReads(async queries => {
        const res = response();
        await routeHandler('/:id/versions')(request(), res);
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.data[0].version_number, 1);
        assert.equal(queries.length, 2);
        assertRead(queries[0], 'Resume', 'resumes');
        assert.match(queries[0].sql, /`Resume`\.`user_id` = 7/);
        assertRead(queries[1], 'ResumeVersion', 'resumeversions');
        assert.match(queries[1].sql, /`ResumeVersion`\.`resume_id` = '41'/);
        assert.match(queries[1].sql, /ORDER BY `ResumeVersion`\.`version_number` DESC/);
    });
});

test('read handlers never query child tables when the selected resume is not owned by the caller', async () => {
    for (const method of ['getResume', 'getResumePdf', 'getVersions']) {
        await captureReads(async queries => {
            const res = response();
            await controller[method](request(), res);
            assert.equal(res.statusCode, 404, method);
            assert.equal(queries.length, 1, method);
            assertRead(queries[0], 'Resume', 'resumes');
            assert.match(queries[0].sql, /`Resume`\.`user_id` = 7/);
        }, false);
    }
});
