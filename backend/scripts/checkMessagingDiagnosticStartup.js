// Offline release check: never imports the application, connects to a database,
// starts a server, fetches Git refs, commits, pushes, or deploys.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const backendDirectory = path.resolve(__dirname, '..');
const expectedScripts = Object.freeze({
    start: 'node server.js',
    'start:diagnose-messaging': 'node scripts/startWithMessagingDiagnostic.js',
    'diagnose:messaging-schema': 'node scripts/diagnoseMessagingSchema.js',
    'verify:diagnostic-startup': 'node scripts/checkMessagingDiagnosticStartup.js'
});
const requiredFiles = ['package.json', 'server.js', 'scripts/startWithMessagingDiagnostic.js', 'scripts/diagnoseMessagingSchema.js', 'scripts/repairMessagingStorage.js', 'scripts/checkMessagingDiagnosticStartup.js'];

function inspect({ committed = false, read = file => fs.readFileSync(file, 'utf8'), exists = fs.existsSync, git = args => spawnSync('git', args, { cwd: backendDirectory, encoding: 'utf8', windowsHide: true }) } = {}) {
    const result = { package: 'backend/package.json', missingFiles: requiredFiles.filter(file => !exists(path.join(backendDirectory, file))), incorrectScripts: [] };
    const checkScripts = manifest => Object.entries(expectedScripts).filter(([name, command]) => manifest.scripts?.[name] !== command).map(([name]) => name);
    try { result.incorrectScripts = checkScripts(JSON.parse(read(path.join(backendDirectory, 'package.json')))); }
    catch { result.packageUnreadable = true; }
    if (committed) {
        result.missingFromCommit = requiredFiles.filter(file => git(['cat-file', '-e', `HEAD:backend/${file}`]).status !== 0);
        const manifest = git(['show', 'HEAD:backend/package.json']);
        try {
            if (manifest.status !== 0) throw new Error('Unavailable commit.');
            result.incorrectCommittedScripts = checkScripts(JSON.parse(manifest.stdout));
        } catch { result.committedPackageUnreadable = true; }
    }
    result.ready = !result.packageUnreadable && !result.missingFiles.length && !result.incorrectScripts.length && (!committed || !result.committedPackageUnreadable && !result.missingFromCommit.length && !result.incorrectCommittedScripts.length);
    return result;
}

if (require.main === module) {
    // These are the only accepted flags; none can start an app or apply a migration.
    const unknown = process.argv.slice(2).some(arg => arg !== '--committed');
    const result = unknown ? { ready: false, error: 'Only --committed is supported.' } : inspect({ committed: process.argv.includes('--committed') });
    console.log('[messaging-startup-check] ' + JSON.stringify(result));
    process.exitCode = result.ready ? 0 : 1;
}
module.exports = { inspect, expectedScripts, requiredFiles };
