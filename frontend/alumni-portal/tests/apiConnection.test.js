import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import { loadEnv } from 'vite';
const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('..', import.meta.url));
function loadApi(env = {}) {
 const result = buildSync({ entryPoints: [fileURLToPath(new URL('../src/services/api.js', import.meta.url))], bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external', define: { 'import.meta.env': JSON.stringify(env) }, logLevel: 'silent' });
 const mod = { exports: {} };
 new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, mod, mod.exports);
 return mod.exports;
}
let storedToken = null;
globalThis.localStorage = { getItem: key => key === 'token' ? storedToken : null };
globalThis.window = { location: { origin: 'https://djemc-alumni-portal.web.app' } };
const adapter = (inspect, data = { token: 'valid-session-token', user: { id: 1, role: 'alumni' } }) => async config => {
 inspect(config);
 return { config, data, status: 200, statusText: 'OK', headers: { 'content-type': typeof data === 'string' ? 'text/html' : 'application/json' } };
};
test('production and local defaults target the correct backend and respect overrides', () => {
 assert.equal(loadApi(loadEnv('production', root)).API_BASE_URL, 'https://djemc-alumni-backend.onrender.com/api');
 assert.equal(loadApi({ PROD: true }).API_BASE_URL, 'https://djemc-alumni-backend.onrender.com/api');
 assert.equal(loadApi({ PROD: false }).API_BASE_URL, 'http://localhost:5000/api');
 assert.equal(loadApi({ PROD: true, VITE_API_BASE_URL: ' https://custom-api.example/api/ ' }).API_BASE_URL, 'https://custom-api.example/api');
 assert.equal(loadApi({ VITE_API_BASE_URL: 'http://localhost:5000/api' }).API_BASE_URL, 'http://localhost:5000/api');
});
test('login omits invalid tokens and still receives JSON through the production API base', async () => {
 const { api } = loadApi(loadEnv('production', root));
 for (const value of [null, '', 'undefined', 'null', ' UNDEFINED ', '  ']) {
  storedToken = value;
  const result = await api.post('/auth/login', { email: 'test@example.invalid', password: 'test' }, false, { adapter: adapter(config => {
   assert.equal(require('axios').getUri(config), 'https://djemc-alumni-backend.onrender.com/api/auth/login');
   assert.equal(config.headers.get('Authorization'), undefined);
  }) });
  assert.equal(result.user.role, 'alumni');
 }
});
test('normal authenticated requests retain their bearer token', async () => {
 storedToken = 'valid-session-token';
 const { api } = loadApi({});
 await api.get('/profile', true, { adapter: adapter(config => assert.equal(config.headers.get('Authorization'), 'Bearer valid-session-token')) });
});
test('protected requests reject invalid local sessions before making requests', () => {
 const { api } = loadApi({});
 for (const value of ['undefined', 'null', null, '']) {
  storedToken = value;
  assert.throws(() => api.get('/profile', true), /log in first/);
 }
});
test('HTML and malformed login responses cannot be treated as a successful login', async () => {
 storedToken = null;
 const { api } = loadApi({});
 for (const data of ['<!doctype html><html>Firebase SPA</html>', {}, { user: { id: 1 } }, { token: 'undefined', user: { id: 1 } }]) {
  await assert.rejects(api.post('/auth/login', {}, false, { adapter: adapter(() => {}, data) }), /non-JSON|invalid response/);
 }
});

