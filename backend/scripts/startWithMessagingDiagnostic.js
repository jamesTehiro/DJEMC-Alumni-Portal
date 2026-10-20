const path = require('node:path');
const childProcess = require('node:child_process');
const root = path.resolve(__dirname, '..');
const prefix = '[messaging-schema-diagnostic] ';
const diagnosticEvents = new Set(['begin', 'table', 'migration-dry-run', 'complete', 'unavailable', 'connection_cleanup_failed']);

function forwardDiagnosticOutput(stream, log) {
    let pending = '';
    stream?.on('data', chunk => {
        pending += String(chunk);
        const lines = pending.split(/\r?\n/);
        pending = lines.pop();
        for (const line of lines) {
            if (line.length > 16384 || !line.startsWith(prefix)) continue;
            try {
                const value = JSON.parse(line.slice(prefix.length));
                if (value && diagnosticEvents.has(value.event)) log(prefix + JSON.stringify(value));
            } catch { /* Ignore dependency chatter and malformed output. */ }
        }
        if (pending.length > 16384) pending = '';
    });
}

async function diagnoseBeforeStart(spawn = childProcess.spawn, timeoutMs = 20000, log = console.log, onChild = () => {}) {
    await new Promise(resolve => {
        let finished = false, child, timer;
        const finish = reason => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            log('[messaging-schema-diagnostic] ' + JSON.stringify({ event: 'startup_hook_finished', reason, backendWillStart: true }));
            resolve();
        };
        try {
            child = spawn(process.execPath, [path.join(__dirname, 'diagnoseMessagingSchema.js')], { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'ignore'] });
            forwardDiagnosticOutput(child.stdout, log);
            onChild(child);
            child.once('error', () => finish('diagnostic_process_unavailable'));
            child.once('close', code => finish(code === 0 ? 'diagnostic_finished' : 'diagnostic_failed'));
            timer = setTimeout(() => {
                // Kill only the child created above, never another process.
                try { child.kill('SIGKILL'); } catch { /* Startup must continue. */ }
                finish('diagnostic_timeout');
            }, timeoutMs);
        } catch { finish('diagnostic_process_unavailable'); }
    });
}

async function startBackend({ spawn = childProcess.spawn, timeoutMs = 20000, log = console.log, onChild = () => {}, shouldStart = () => true, onServer = () => {} } = {}) {
    try { await diagnoseBeforeStart(spawn, timeoutMs, log, onChild); }
    catch { /* The diagnostic must never block ordinary backend startup. */ }
    if (!shouldStart()) return null;
    const server = spawn(process.execPath, [path.join(root, 'server.js')], { cwd: root, env: process.env, stdio: 'inherit' });
    onChild(server);
    onServer(server);
    return server;
}

if (require.main === module) {
    let activeChild;
    let stopping = false;
    for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
        stopping = true;
        activeChild?.kill(signal);
        if (!activeChild) process.exit(0);
    });
    startBackend({ onChild: child => { activeChild = child; }, shouldStart: () => !stopping, onServer: server => {
        server.once('error', () => { console.error('Backend process could not be started.'); process.exitCode = 1; });
        server.once('exit', (code, signal) => { process.exitCode = stopping ? 0 : Number.isInteger(code) ? code : signal ? 1 : 0; });
    } }).catch(() => {
        console.error('Backend process could not be started.'); process.exitCode = 1;
    });
}
module.exports = { diagnoseBeforeStart, startBackend };
