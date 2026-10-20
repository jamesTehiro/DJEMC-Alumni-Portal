const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { inspect, expectedScripts } = require('../scripts/checkMessagingDiagnosticStartup');

test('backend npm commands and entrypoint files resolve with normal start preserved', () => {
    assert.equal(inspect().ready, true);
    assert.equal(require('../package.json').scripts.start, 'node server.js');
});

test('the offline check detects missing package scripts and missing wrapper files', () => {
    const result = inspect({ read: () => JSON.stringify({ scripts: { start: 'node server.js' } }), exists: file => path.basename(file) !== 'startWithMessagingDiagnostic.js' });
    assert.equal(result.ready, false);
    assert.deepEqual(result.missingFiles, ['scripts/startWithMessagingDiagnostic.js']);
    assert.ok(result.incorrectScripts.includes('start:diagnose-messaging'));
    assert.equal(result.incorrectScripts.includes('start'), false);
});

test('the committed check detects a release where the scripts exist only in the working tree', () => {
    const result = inspect({ exists: () => true, read: () => JSON.stringify({ scripts: expectedScripts }), committed: true, git: args => args[0] === 'show'
        ? { status: 0, stdout: JSON.stringify({ scripts: { start: 'node server.js' } }) }
        : { status: args.at(-1).endsWith('/startWithMessagingDiagnostic.js') ? 1 : 0 } });
    assert.equal(result.ready, false);
    assert.deepEqual(result.missingFromCommit, ['scripts/startWithMessagingDiagnostic.js']);
    assert.ok(result.incorrectCommittedScripts.includes('start:diagnose-messaging'));
});

test('a complete committed release passes without printing package contents or secrets', () => {
    const manifest = JSON.stringify({ scripts: expectedScripts, privateCredential: 'never-print-this' });
    const result = inspect({ exists: () => true, read: () => manifest, committed: true, git: () => ({ status: 0, stdout: manifest }) });
    assert.equal(result.ready, true);
    assert.doesNotMatch(JSON.stringify(result), /never-print-this/);
});
