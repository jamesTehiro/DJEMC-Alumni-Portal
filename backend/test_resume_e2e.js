const http = require('http');
const db = require('./models');

const BASE_URL = 'http://localhost:5000';
let token = '';
let testUserId = null;
let resumeId = null;
let createdResumeId = null;

const request = (method, path, body = null, authToken = null) => {
    return new Promise((resolve, reject) => {
        const url = new URL(path, BASE_URL);
        const options = {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            method,
            headers: { 'Content-Type': 'application/json' }
        };
        if (authToken) options.headers['Authorization'] = `Bearer ${authToken}`;

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, body: JSON.parse(data) });
                } catch {
                    resolve({ status: res.statusCode, body: data });
                }
            });
        });
        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
};

const test = async (name, fn) => {
    try {
        await fn();
        console.log(`  ✓ ${name}`);
    } catch (err) {
        console.log(`  ✗ ${name}: ${err.message}`);
        process.exitCode = 1;
    }
};

const assert = (condition, msg) => {
    if (!condition) throw new Error(msg || 'Assertion failed');
};

const main = async () => {
    console.log('\n=== RESUME BUILDER END-TO-END VALIDATION ===\n');

    // 1. Database connection
    console.log('1. DATABASE CONNECTION');
    await test('Database connection', async () => {
        await db.sequelize.authenticate();
    });

    // 2. Verify all models load correctly
    console.log('\n2. MODEL LOADING');
    await test('All resume models loaded', async () => {
        const models = ['Resume', 'ResumePersonalInfo', 'ResumeSummary', 'ResumeEducation',
            'ResumeWorkExperience', 'ResumeSkill', 'ResumeProject', 'ResumeCertification',
            'ResumeTraining', 'ResumeSeminar', 'ResumeAward', 'ResumeOrganization',
            'ResumeVolunteerWork', 'ResumeLanguage', 'ResumeReference', 'ResumeVersion'];
        models.forEach(m => {
            assert(db[m], `Model ${m} not loaded`);
            assert(db[m].tableName, `Model ${m} has no tableName`);
        });
    });

    await test('All table names match database', async () => {
        const expectedTables = ['Resumes', 'ResumePersonalInfo', 'ResumeSummaries', 'ResumeEducation',
            'ResumeWorkExperience', 'ResumeSkills', 'ResumeProjects', 'ResumeCertifications',
            'ResumeTrainings', 'ResumeSeminars', 'ResumeAwards', 'ResumeOrganizations',
            'ResumeVolunteerWork', 'ResumeLanguages', 'ResumeReferences', 'ResumeVersions'];
        const models = [db.Resume, db.ResumePersonalInfo, db.ResumeSummary, db.ResumeEducation,
        db.ResumeWorkExperience, db.ResumeSkill, db.ResumeProject, db.ResumeCertification,
        db.ResumeTraining, db.ResumeSeminar, db.ResumeAward, db.ResumeOrganization,
        db.ResumeVolunteerWork, db.ResumeLanguage, db.ResumeReference, db.ResumeVersion];
        models.forEach((m, i) => {
            assert(m.tableName === expectedTables[i], `${m.name} tableName is "${m.tableName}" expected "${expectedTables[i]}"`);
        });
        console.log(`       All ${models.length} models have correct tableName`);
    });

    // 3. Verify timestamps configuration
    console.log('\n3. TIMESTAMPS CONFIGURATION');
    await test('Resume has timestamps with underscored', async () => {
        const attrs = db.Resume.rawAttributes;
        assert(attrs.created_at, 'Resume missing created_at');
        assert(attrs.updated_at, 'Resume missing updated_at');
    });
    await test('ResumeVersion has created_at only (no updated_at)', async () => {
        const attrs = db.ResumeVersion.rawAttributes;
        assert(attrs.created_at, 'ResumeVersion missing created_at');
        assert(!attrs.updated_at, 'ResumeVersion should not have updated_at');
    });
    await test('All child models have timestamps', async () => {
        const childModels = [db.ResumePersonalInfo, db.ResumeSummary, db.ResumeEducation,
        db.ResumeWorkExperience, db.ResumeSkill, db.ResumeProject, db.ResumeCertification,
        db.ResumeTraining, db.ResumeSeminar, db.ResumeAward, db.ResumeOrganization,
        db.ResumeVolunteerWork, db.ResumeLanguage, db.ResumeReference];
        childModels.forEach(m => {
            assert(m.rawAttributes.created_at, `${m.name} missing created_at`);
            assert(m.rawAttributes.updated_at, `${m.name} missing updated_at`);
        });
    });

    // 4. Verify associations
    console.log('\n4. ASSOCIATIONS');
    await test('Resume has all associations', async () => {
        const assoc = db.Resume.associations;
        assert(assoc.personalInfo, 'Missing personalInfo association');
        assert(assoc.summary, 'Missing summary association');
        assert(assoc.education, 'Missing education association');
        assert(assoc.workExperience, 'Missing workExperience association');
        assert(assoc.skills, 'Missing skills association');
        assert(assoc.projects, 'Missing projects association');
        assert(assoc.certifications, 'Missing certifications association');
        assert(assoc.trainings, 'Missing trainings association');
        assert(assoc.seminars, 'Missing seminars association');
        assert(assoc.awards, 'Missing awards association');
        assert(assoc.organizations, 'Missing organizations association');
        assert(assoc.volunteerWork, 'Missing volunteerWork association');
        assert(assoc.languages, 'Missing languages association');
        assert(assoc.references, 'Missing references association');
        assert(assoc.versions, 'Missing versions association');
        assert(assoc.User, 'Missing User association');
        console.log(`       All ${Object.keys(assoc).length} associations verified`);
    });

    // 5. Test actual database queries
    console.log('\n5. DATABASE QUERIES');
    await test('Resume.findAll() works', async () => {
        const resumes = await db.Resume.findAll();
        assert(Array.isArray(resumes), 'findAll did not return array');
        console.log(`       Found ${resumes.length} resumes in database`);
    });

    await test('Resume.findAll() with include works (no EagerLoadingError)', async () => {
        const resumes = await db.Resume.findAll({
            include: [
                { model: db.ResumePersonalInfo, as: 'personalInfo' },
                { model: db.ResumeSummary, as: 'summary' },
                { model: db.ResumeEducation, as: 'education' },
                { model: db.ResumeWorkExperience, as: 'workExperience' },
                { model: db.ResumeSkill, as: 'skills' },
                { model: db.ResumeProject, as: 'projects' },
                { model: db.ResumeCertification, as: 'certifications' },
                { model: db.ResumeTraining, as: 'trainings' },
                { model: db.ResumeSeminar, as: 'seminars' },
                { model: db.ResumeAward, as: 'awards' },
                { model: db.ResumeOrganization, as: 'organizations' },
                { model: db.ResumeVolunteerWork, as: 'volunteerWork' },
                { model: db.ResumeLanguage, as: 'languages' },
                { model: db.ResumeReference, as: 'references' }
            ]
        });
        assert(Array.isArray(resumes), 'findAll with include failed');
        console.log(`       Loaded ${resumes.length} resumes with all associations`);
    });

    // 6. Test API endpoints
    console.log('\n6. API ENDPOINTS');

    // Register a test user
    const testEmail = `test_resume_${Date.now()}@test.com`;
    await test('POST /api/auth/register - Create test user', async () => {
        const res = await request('POST', '/api/auth/register', {
            email: testEmail,
            password: 'Test123!',
            role: 'alumni',
            first_name: 'Test',
            last_name: 'User'
        });
        assert(res.status === 201 || res.status === 200, `Register failed: ${res.status}`);
        if (res.body.token) token = res.body.token;
        if (res.body.data?.id) testUserId = res.body.data.id;
        if (res.body.user?.id) testUserId = res.body.user.id;
        console.log(`       User created: ${testEmail}`);
    });

    // Login
    await test('POST /api/auth/login - Login test user', async () => {
        const res = await request('POST', '/api/auth/login', {
            email: testEmail,
            password: 'Test123!'
        });
        assert(res.status === 200, `Login failed: ${res.status}`);
        token = res.body.token || res.body.data?.token;
        assert(token, 'No token returned');
        console.log(`       Token obtained`);
    });

    // GET /api/resumes (empty)
    await test('GET /api/resumes - Empty list', async () => {
        const res = await request('GET', '/api/resumes', null, token);
        assert(res.status === 200, `GET resumes failed: ${res.status}`);
        const data = res.body.data || res.body;
        assert(Array.isArray(data), 'Response data is not an array');
        console.log(`       Found ${data.length} resumes`);
    });

    // POST /api/resumes - Create resume
    await test('POST /api/resumes - Create resume', async () => {
        const res = await request('POST', '/api/resumes', {
            title: 'My Test Resume',
            template_id: 'modern-professional',
            is_default: true
        }, token);
        assert(res.status === 201, `Create resume failed: ${res.status}`);
        const data = res.body.data || res.body;
        createdResumeId = data.id;
        assert(createdResumeId, 'No resume id returned');
        console.log(`       Created resume ID: ${createdResumeId}`);
    });

    // GET /api/resumes (with one)
    await test('GET /api/resumes - With resume', async () => {
        const res = await request('GET', '/api/resumes', null, token);
        assert(res.status === 200, `GET resumes failed: ${res.status}`);
        const data = res.body.data || res.body;
        assert(data.length >= 1, 'Should have at least 1 resume');
        console.log(`       Found ${data.length} resume(s)`);
    });

    // GET /api/resumes/:id
    await test('GET /api/resumes/:id - Get single resume', async () => {
        const res = await request('GET', `/api/resumes/${createdResumeId}`, null, token);
        assert(res.status === 200, `GET resume failed: ${res.status}`);
        const data = res.body.data || res.body;
        assert(data.id === createdResumeId || data.id === createdResumeId, 'Wrong resume returned');
        console.log(`       Retrieved resume: ${data.title || data.id}`);
    });

    // PUT /api/resumes/:id
    await test('PUT /api/resumes/:id - Update resume', async () => {
        const res = await request('PUT', `/api/resumes/${createdResumeId}`, {
            title: 'Updated Resume Title',
            font_family: 'Arial, sans-serif'
        }, token);
        assert(res.status === 200, `Update resume failed: ${res.status}`);
        const data = res.body.data || res.body;
        console.log(`       Updated resume title: ${data.title}`);
    });

    // POST /api/resumes/:id/duplicate
    await test('POST /api/resumes/:id/duplicate - Duplicate resume', async () => {
        const res = await request('POST', `/api/resumes/${createdResumeId}/duplicate`, null, token);
        assert(res.status === 201, `Duplicate resume failed: ${res.status}`);
        const data = res.body.data || res.body;
        resumeId = data.id;
        assert(resumeId !== createdResumeId, 'Duplicate should have different id');
        console.log(`       Duplicated to resume ID: ${resumeId}`);
    });

    // POST /api/resumes/:id/snapshot
    await test('POST /api/resumes/:id/snapshot - Create snapshot', async () => {
        const res = await request('POST', `/api/resumes/${createdResumeId}/snapshot`, {
            change_summary: 'Test snapshot'
        }, token);
        assert(res.status === 201, `Create snapshot failed: ${res.status}`);
        const data = res.body.data || res.body;
        assert(data.version_number, 'No version_number returned');
        console.log(`       Created version: ${data.version_number}`);
    });

    // GET /api/resumes/:id/versions
    await test('GET /api/resumes/:id/versions - Get versions', async () => {
        const res = await request('GET', `/api/resumes/${createdResumeId}/versions`, null, token);
        assert(res.status === 200, `Get versions failed: ${res.status}`);
        const data = res.body.data || res.body;
        assert(data.length >= 1, 'Should have at least 1 version');
        console.log(`       Found ${data.length} version(s)`);
    });

    // DELETE /api/resumes/:id
    await test('DELETE /api/resumes/:id - Delete duplicate resume', async () => {
        const res = await request('DELETE', `/api/resumes/${resumeId}`, null, token);
        assert(res.status === 200, `Delete resume failed: ${res.status}`);
        console.log(`       Deleted resume ID: ${resumeId}`);
    });

    // DELETE original resume
    await test('DELETE /api/resumes/:id - Delete original resume', async () => {
        const res = await request('DELETE', `/api/resumes/${createdResumeId}`, null, token);
        assert(res.status === 200, `Delete original failed: ${res.status}`);
        console.log(`       Deleted original resume ID: ${createdResumeId}`);
    });

    // 7. Verify SQL queries use correct table names
    console.log('\n7. SQL TABLE NAME VERIFICATION');
    await test('Resume queries use "Resumes" table', async () => {
        const [results] = await db.sequelize.query('SELECT COUNT(*) as count FROM Resumes');
        assert(results[0].count !== undefined, 'Resumes table query failed');
        console.log(`       Resumes table accessible, count: ${results[0].count}`);
    });
    await test('ResumeVersions table accessible', async () => {
        const [results] = await db.sequelize.query('SELECT COUNT(*) as count FROM ResumeVersions');
        assert(results[0].count !== undefined, 'ResumeVersions table query failed');
        console.log(`       ResumeVersions table accessible, count: ${results[0].count}`);
    });
    await test('ResumeSummaries table accessible', async () => {
        const [results] = await db.sequelize.query('SELECT COUNT(*) as count FROM ResumeSummaries');
        assert(results[0].count !== undefined, 'ResumeSummaries table query failed');
        console.log(`       ResumeSummaries table accessible`);
    });

    console.log('\n=== VALIDATION COMPLETE ===');
    if (process.exitCode) {
        console.log('Some tests FAILED. See above for details.\n');
    } else {
        console.log('All tests PASSED. Resume Builder is fully operational.\n');
    }
    process.exit(process.exitCode || 0);
};

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});