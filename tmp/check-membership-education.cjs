const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const { pathToFileURL } = require('url');
const frontend = path.resolve('frontend/alumni-portal');
const req = createRequire(path.join(frontend, 'package.json'));
const React = req('react');
const { renderToStaticMarkup } = req('react-dom/server');
const { buildSync } = req('esbuild');
function component(file, name) {
 const result = buildSync({ entryPoints: [path.join(frontend, file)], bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external', define: { 'import.meta.env': '{}' }, loader: { '.css': 'empty' }, logLevel: 'silent' });
 const mod = { exports: {} }; new Function('require', 'module', 'exports', result.outputFiles[0].text)(req, mod, mod.exports); return mod.exports[name];
}
(async () => {
 const Education = component('src/pages/MembershipApplicationPage.jsx', 'MembershipEducationTable');
 const Review = component('src/components/membership/MembershipReview.jsx', 'default');
 const rows = ['Elementary', 'High School', 'Technical / Vocational', "Bachelor's Degree", 'Masteral Degree', 'Doctorate Degree'].map(level => ({ level, school_name: 'Don Jose Ecleo Memorial College', address: 'San Jose, Dinagat Islands', year_graduated: '2024', honors_awards: 'With Honors', program: 'HIDDEN_PROGRAM', competency: 'HIDDEN_COMPETENCY' }));
 const css = ['node_modules/bootstrap/dist/css/bootstrap.min.css', 'src/pages/MembershipApplicationPage.css', 'src/components/membership/MembershipReview.css'].map(file => fs.readFileSync(path.join(frontend, file), 'utf8')).join('\n');
 const markup = renderToStaticMarkup(React.createElement(Education, { rows, onChange() {} }));
 const review = renderToStaticMarkup(React.createElement(Review, { application: { educational_attainment: rows } }));
 const out = path.resolve('tmp/pdfs/membership-education'); fs.mkdirSync(out, { recursive: true });
 const puppeteer = (await import(pathToFileURL(req.resolve('puppeteer')).href)).default;
 let executablePath = puppeteer.executablePath();
 if (!fs.existsSync(executablePath)) executablePath = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
 const browser = await puppeteer.launch({ headless: true, timeout: 60000, executablePath });
 try {
 const page = await browser.newPage();
 for (const width of [1280, 390]) {
  await page.setViewport({ width, height: 1000 });
  await page.setContent('<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><style>' + css + '</style><main class="membership-page" style="padding:16px"><h2>II. Educational Attainment</h2>' + markup + review + '</main>');
  const result = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, tables: [...document.querySelectorAll('.membership-education-table, .membership-review-education table')].map(t => ({ width: t.getBoundingClientRect().width, scroll: t.scrollWidth })) }));
  if (result.scroll > width || result.tables.some(t => t.scroll > t.width + 1)) throw new Error('Horizontal overflow: ' + JSON.stringify(result));
  if ((await page.content()).includes('HIDDEN_PROGRAM') || (await page.content()).includes('HIDDEN_COMPETENCY')) throw new Error('Legacy values exposed');
  await page.screenshot({ path: path.join(out, 'education-' + width + '.png'), fullPage: true });
  console.log('PASS desktop/mobile education form and review:', JSON.stringify(result));
 }
 const { buildMembershipDocumentHtml } = require('../backend/services/membershipDocument');
 const { renderResumePdf } = require('../backend/services/resumePdf');
 const html = buildMembershipDocumentHtml({ id: 1, educational_attainment: rows, personal_details: { first_name: 'Alex', last_name: 'Cruz' }, academic_program: 'HIDDEN_PROGRAM', graduation_year: 2024 });
 if (html.includes('HIDDEN_')) throw new Error('PDF legacy values exposed');
 fs.writeFileSync(path.join(out, 'education.pdf'), await renderResumePdf(html));
 await page.setViewport({ width: 1000, height: 1400 }); await page.setContent(html); await page.screenshot({ path: path.join(out, 'document.png'), fullPage: true });
 console.log('PASS membership PDF generated without removed fields.');
 } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });

