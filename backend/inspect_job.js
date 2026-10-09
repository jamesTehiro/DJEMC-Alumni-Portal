const db = require('./models');

(async () => {
    const job = await db.Job.findOne({ order: [['createdAt', 'DESC']] });
    if (!job) {
        console.log('No jobs found');
        process.exit(0);
    }

    console.log('=== JOB RECORD ===');
    console.log('id:', job.id);
    console.log('title:', job.title);
    console.log('has_requirements:', job.has_requirements);
    console.log('current_requirement_version:', job.current_requirement_version);

    const count = await db.JobRequirement.count({
        where: { job_id: job.id, version: job.current_requirement_version }
    });
    console.log('\n=== JOB REQUIREMENTS COUNT ===');
    console.log('count:', count);

    const reqs = await db.JobRequirement.findAll({
        where: { job_id: job.id, version: job.current_requirement_version }
    });
    console.log('\n=== REQUIREMENTS ===');
    console.log(JSON.stringify(reqs.map(r => r.toJSON()), null, 2));

    const groups = await db.RequirementGroup.findAll({
        where: { job_id: job.id, version: job.current_requirement_version }
    });
    console.log('\n=== GROUPS ===');
    console.log(JSON.stringify(groups.map(g => g.toJSON()), null, 2));

    process.exit(0);
})().catch(err => {
    console.error(err);
    process.exit(1);
});