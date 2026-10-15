// Real PDF smoke checks reuse the application's canonical React renderer and PDF service.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const assert = require('node:assert/strict');
const { renderResumePdf, validateResumeHtml } = require('../services/resumePdf');
const root = path.resolve(__dirname, '..', '..');
const frontend = path.join(root, 'frontend', 'alumni-portal');
const frontendRequire = createRequire(path.join(frontend, 'package.json'));
const React = frontendRequire('react');
const { renderToStaticMarkup } = frontendRequire('react-dom/server');
const { buildSync } = frontendRequire('esbuild');
const code = buildSync({ entryPoints: [path.join(frontend, 'src/components/resume/templates/ResumePreviewTemplate.jsx')], bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false }).outputFiles[0].text;
const compiled = { exports: {} }; new Function('require', 'module', 'exports', code)(frontendRequire, compiled, compiled.exports);
const Template = compiled.exports.default;
const css = fs.readFileSync(path.join(frontend, 'src/components/resume/ResumeTemplates.css'), 'utf8');
const output = path.join(root, 'tmp', 'pdfs', 'resume-checks');
const ids = ['modern-professional', 'executive-corporate', 'university-green', 'minimal-black-white', 'creative-professional'];

(async () => {
    fs.mkdirSync(output, { recursive: true });
    for (const template_id of ids) {
        const resume = { id: 41, template_id, title: 'Resume export check', font_size: 10,
            personalInfo: { full_name: 'Alex Dela Cruz', professional_title: 'Business Administration Graduate', email: 'alex@example.com', phone: '+63 912 345 6789', address: 'Manila, Philippines', photo_url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXioAAAAASUVORK5CYII=' },
            summary: { content: 'Organized and dependable graduate with experience in records management and community projects.' },
            workExperience: [{ job_title: 'Administrative Intern', company: 'Community Services Office', start_date: '2025-01-01', end_date: '2025-06-01', description: 'Prepared records and coordinated daily requests. Supported staff with reports, schedules and community activities.' }],
            education: [{ institution: 'Don Jose Ecleo Memorial College', degree: 'Bachelor of Science', field_of_study: 'Business Administration', end_date: '2025-06-01' }],
            skills: [{ skill_name: 'Communication' }, { skill_name: 'Office administration' }], languages: [{ language: 'English', proficiency: 'Professional' }]
        };
        const first = renderToStaticMarkup(React.createElement(Template, { resume })).replace('djemc-resume-document ', 'djemc-resume-document djemc-resume-page ');
        const continued = renderToStaticMarkup(React.createElement(Template, { resume: { ...resume, summary: {}, workExperience: [], education: [], skills: [], languages: [], projects: [{ project_name: 'Community Resource Directory', technologies: 'React', description: 'Created a directory of local services and volunteer opportunities.' }], certifications: [{ name: 'Professional Development Certificate', issuer: 'Learning Center', issue_date: '2025-03-01' }] } })).replace('djemc-resume-document ', 'djemc-resume-document djemc-resume-page ');
        const html = `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:A4;margin:0}html,body{margin:0;padding:0}${css}</style></head><body>${first}${continued}</body></html>`;
        validateResumeHtml(html, 41, template_id);
        const bytes = await renderResumePdf(html);
        assert.ok(bytes.subarray(0, 5).toString() === '%PDF-'); assert.ok(bytes.length > 5000);
        assert.ok(bytes.toString('latin1').includes('/Subtype /Image'), 'The embedded profile image must appear in the PDF.');
        fs.writeFileSync(path.join(output, `${template_id}.pdf`), bytes);
        console.log(`PASS ${template_id}: real PDF generated (${bytes.length} bytes), canonical template styling and embedded photo.`);
    }
    console.log('Artifacts:', output);
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
