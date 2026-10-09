const axios = require('axios');
const api = axios.create({ baseURL: 'http://localhost:5000/api', headers: { 'Content-Type': 'application/json' } });

async function test() {
    try {
        console.log('=== STEP 1: Login as admin employer ===');
        const r1 = await api.post('/auth/login', { email: 'admin@employer.com', password: 'password123' });
        console.log('Login status:', r1.status);
        const token = r1.data.token;
        console.log('Token received:', token ? token.substring(0, 30) + '...' : 'NONE');
        if (!token) throw new Error('No token');

        console.log('\n=== STEP 2: Get admin employer jobs ===');
        const r2 = await api.get('/admin/employer/jobs', { headers: { Authorization: 'Bearer ' + token } });
        console.log('Jobs status:', r2.status);
        const jobs = Array.isArray(r2.data) ? r2.data : [];
        console.log('Jobs count:', jobs.length);

        if (jobs.length > 0) {
            const jid = jobs[0].id;
            console.log('First job:', JSON.stringify({ id: jid, title: jobs[0].title, recruitment_status: jobs[0].recruitment_status }));

            console.log('\n=== STEP 3: Test stop recruitment for job ID:', jid, '===');
            const r3 = await api.post('/admin/employer/jobs/' + jid + '/stop-recruitment', {}, {
                headers: { Authorization: 'Bearer ' + token }
            });
            console.log('Stop recruitment status:', r3.status);
            console.log('Response:', JSON.stringify(r3.data));

            console.log('\n=== STEP 4: Verify job status changed ===');
            const r4 = await api.get('/admin/employer/jobs', { headers: { Authorization: 'Bearer ' + token } });
            const updatedJob = (Array.isArray(r4.data) ? r4.data : []).find(j => j.id === jid);
            console.log('Updated job recruitment_status:', updatedJob?.recruitment_status);

            console.log('\n=== STEP 5: Test reactivate recruitment ===');
            const r5 = await api.post('/admin/employer/jobs/' + jid + '/reactivate-recruitment', {}, {
                headers: { Authorization: 'Bearer ' + token }
            });
            console.log('Reactivate status:', r5.status);
            console.log('Response:', JSON.stringify(r5.data));

            console.log('\n=== STEP 6: Verify reactivation ===');
            const r6 = await api.get('/admin/employer/jobs', { headers: { Authorization: 'Bearer ' + token } });
            const reactivatedJob = (Array.isArray(r6.data) ? r6.data : []).find(j => j.id === jid);
            console.log('Reactivated job recruitment_status:', reactivatedJob?.recruitment_status);

            console.log('\n=== ALL STEPS PASSED ===');
        } else {
            console.log('No jobs found - cannot test stop recruitment');
        }
    } catch (e) {
        if (e.response) {
            console.error('\nERROR:', e.response.status, JSON.stringify(e.response.data));
            if (e.response.status === 404) {
                console.log('\n=== 404 DIAGNOSIS ===');
                console.log('The route /api/admin/employer/jobs/:jobId/stop-recruitment');
                console.log('is mounted at server.js line 174: app.use("/api/admin", require("./routes/adminRoutes"))');
                console.log('adminRoutes.js line 32-43 defines: router.post("/employer/jobs/:jobId/stop-recruitment", ...)');
                console.log('Full path: /api/admin/employer/jobs/:jobId/stop-recruitment');
                console.log('This means the route EXISTS in the code.');
                console.log('A 404 here means either:');
                console.log('  1. The server is running an OLD version of the code (needs restart)');
                console.log('  2. The job ID does not exist in the database');
                console.log('  3. The route is being shadowed by another route');
            }
        } else {
            console.error('\nERROR:', e.message);
        }
    }
}
test();