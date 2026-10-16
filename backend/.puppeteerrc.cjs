const path = require('node:path');

// Keep Chrome in the deployed dependency tree rather than a build-user HOME cache.
module.exports = {
    cacheDirectory: path.join(__dirname, 'node_modules', '.cache', 'puppeteer'),
    chrome: { skipDownload: false },
    'chrome-headless-shell': { skipDownload: true },
    firefox: { skipDownload: true }
};
