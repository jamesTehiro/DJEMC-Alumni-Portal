const { pathToFileURL } = require('node:url');
const path = require('node:path');
const fs = require('node:fs');

const MAX_HTML_BYTES = 2 * 1024 * 1024;
let activeRenders = 0;

function validateResumeHtml(html, resumeId, templateId) {
    if (typeof html !== 'string' || !html.trim()) throw Object.assign(new Error('The resume document is required.'), { status: 400 });
    if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) throw Object.assign(new Error('The resume is too large to export.'), { status: 413 });
    if (/<\s*(script|iframe|object|embed|base)\b/i.test(html) || /<meta[^>]*http-equiv/i.test(html)) {
        throw Object.assign(new Error('The resume contains unsupported document markup.'), { status: 400 });
    }
    if (!html.includes(`data-resume-id="${resumeId}"`) || !html.includes(`data-template-id="${templateId}"`) || !html.includes('djemc-resume-page')) {
        throw Object.assign(new Error('Save this resume and template before exporting it.'), { status: 409 });
    }
}

function isAllowedResource(url) {
    return /^data:image\/(?:png|jpeg|webp|gif);base64,[a-z\d+/=\s]+$/i.test(url);
}

async function loadPuppeteer() {
    // Reuse the existing project dependency; installations may place it in either package.
    let entry;
    try { entry = require.resolve('puppeteer', { paths: [path.join(__dirname, '..'), path.join(__dirname, '..', '..', 'frontend', 'alumni-portal')] }); }
    catch { throw Object.assign(new Error('PDF export is unavailable: the existing Puppeteer dependency is not installed on this server.'), { status: 503 }); }
    const module = await import(pathToFileURL(entry).href);
    return module.default || module;
}

function resolvePdfBrowser(puppeteer) {
    if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
    let bundled;
    try { bundled = puppeteer.executablePath(); } catch { /* Prefer an existing system browser below. */ }
    if (bundled && fs.existsSync(bundled)) return bundled;
    const candidates = process.platform === 'win32' ? [
        path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe')
    ] : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
    const existing = candidates.find(candidate => fs.existsSync(candidate));
    if (!existing) throw Object.assign(new Error('PDF export needs Chrome or Chromium installed on the server. Configure PUPPETEER_EXECUTABLE_PATH or install the existing Puppeteer browser.'), { status: 503 });
    return existing;
}

async function renderResumePdf(html) {
    if (activeRenders >= 2) throw Object.assign(new Error('PDF generation is busy. Please try again in a moment.'), { status: 503 });
    activeRenders += 1;
    let browser;
    try {
        const puppeteer = await loadPuppeteer();
        browser = await puppeteer.launch({ headless: true, timeout: 20000, executablePath: resolvePdfBrowser(puppeteer) });
        const page = await browser.newPage();
        await page.setJavaScriptEnabled(false);
        await page.setRequestInterception(true);
        page.on('request', request => isAllowedResource(request.url()) ? request.continue() : request.abort());
        page.setDefaultTimeout(20000);
        await page.setContent(html, { waitUntil: 'load', timeout: 20000 });
        await page.emulateMediaType('print');
        return Buffer.from(await page.pdf({ format: 'A4', preferCSSPageSize: true, printBackground: true,
            margin: { top: 0, bottom: 0, left: 0, right: 0 }, timeout: 20000 }));
    } finally {
        try { if (browser) await browser.close(); }
        finally { activeRenders -= 1; }
    }
}

module.exports = { validateResumeHtml, isAllowedResource, renderResumePdf };
