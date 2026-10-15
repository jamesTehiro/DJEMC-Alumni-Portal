const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const db = require('../models');
const baseUrl = `http://127.0.0.1:${process.env.PORT || 5000}/api/resumes`;

(async () => {
    try {
        const resume = await db.Resume.findOne({ where: { is_archived: false }, attributes: ['id', 'user_id', 'template_id'] });
        if (!resume) throw new Error('A saved resume is needed for the read-only API check.');
        const { normalizeTemplateId } = require('../services/resumePersistence');
        const templateId = normalizeTemplateId(resume.template_id);
        const headers = { Authorization: `Bearer ${jwt.sign({ id: resume.user_id, role: 'alumni' }, process.env.JWT_SECRET, { expiresIn: '2m' })}`, 'Content-Type': 'application/json' };
        const list = await fetch(baseUrl, { headers }); assert.equal(list.status, 200); const listBody = await list.json(); assert.ok(Array.isArray(listBody.data));
        const detail = await fetch(`${baseUrl}/${resume.id}`, { headers }); assert.equal(detail.status, 200); const saved = await detail.json(); assert.equal(saved.id, resume.id); assert.ok(saved.personalInfo); assert.ok(Array.isArray(saved.education));
        const unauthorized = await fetch(baseUrl); assert.equal(unauthorized.status, 401);
        const unrelatedHeaders = { ...headers, Authorization: `Bearer ${jwt.sign({ id: -1, role: 'alumni' }, process.env.JWT_SECRET, { expiresIn: '2m' })}` };
        const unrelated = await fetch(`${baseUrl}/${resume.id}`, { headers: unrelatedHeaders }); assert.equal(unrelated.status, 404);
        const forbiddenExport = await fetch(`${baseUrl}/${resume.id}/pdf`, { method: 'POST', headers: unrelatedHeaders, body: JSON.stringify({ html: '<p>Unavailable</p>', template_id: templateId }) }); assert.equal(forbiddenExport.status, 404);
        const wrongTemplate = await fetch(`${baseUrl}/${resume.id}/pdf`, { method: 'POST', headers, body: JSON.stringify({ html: '<p>Unavailable</p>', template_id: 'unsaved-template' }) }); assert.equal(wrongTemplate.status, 409);
        const html = `<!doctype html><html><head><style>@page{size:A4;margin:0}body{margin:0}article{width:210mm;height:297mm;box-sizing:border-box;padding:15mm;font-family:Arial}</style></head><body><article class="djemc-resume-page" data-resume-id="${resume.id}" data-template-id="${templateId}"><h1>Resume API export check</h1><p>This local fixture does not modify the saved resume.</p></article></body></html>`;
        const exported = await fetch(`${baseUrl}/${resume.id}/pdf`, { method: 'POST', headers, body: JSON.stringify({ html, template_id: templateId }) });
        assert.equal(exported.status, 200); assert.ok(exported.headers.get('content-type').includes('application/pdf'));
        assert.ok(Buffer.from(await exported.arrayBuffer()).subarray(0, 5).toString() === '%PDF-');
        console.log('PASS: live GET list/detail, 401 authentication, 404 ownership, 409 unsaved-template protection, and POST PDF download. No records modified.');
    } finally { await db.sequelize.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
