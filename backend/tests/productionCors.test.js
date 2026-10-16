const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../server'), 'utf8');
const start = source.indexOf('const defaultAllowedOrigins =');
const end = source.indexOf('app.use(cors(corsOptions))');
assert.ok(start >= 0 && end > start);
function options(env) {
 return vm.runInNewContext(source.slice(start, end) + '\n corsOptions;', { process: { env }, URL });
}
test('production CORS allows Firebase with JSON and Authorization headers', () => {
 const cors = options({ NODE_ENV: 'production' });
 cors.origin('https://djemc-alumni-portal.web.app', (error, allow) => { assert.equal(error, null); assert.equal(allow, true); });
 assert.ok(cors.allowedHeaders.includes('Authorization'));
 assert.ok(cors.allowedHeaders.includes('Content-Type'));
 assert.ok(cors.methods.includes('POST'));
});
test('production CORS still rejects unrelated origins and honors configured origins', () => {
 const cors = options({ NODE_ENV: 'production', CORS_ORIGINS: 'https://other-approved.example' });
 cors.origin('https://untrusted.example', error => assert.match(error.message, /CORS blocked/));
 cors.origin('https://other-approved.example', (error, allow) => { assert.equal(error, null); assert.equal(allow, true); });
});
test('local development CORS remains available', () => {
 const cors = options({ NODE_ENV: 'development' });
 cors.origin('http://localhost:5173', (error, allow) => { assert.equal(error, null); assert.equal(allow, true); });
});
