import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const bundle = buildSync({ entryPoints: [fileURLToPath(new URL("../src/services/api.js", import.meta.url))], bundle: true, write: false, format: "cjs", platform: "node", packages: "external", define: { "import.meta.env": JSON.stringify({ VITE_API_BASE_URL: "https://backend.example/api/" }) }, logLevel: "silent" });
const mod = { exports: {} };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(require, mod, mod.exports);
const { fetchFile, resolveFileUrl } = mod.exports;
globalThis.localStorage = { getItem: key => key === "token" ? "fixture-token" : null };

test("attachment API paths and absolute URLs resolve once and include authorization", async () => {
    const originalFetch = globalThis.fetch;
    try {
        for (const value of ["/api/messages/files/45", "api/messages/files/45", "https://backend.example/api/messages/files/45", "/api/admin-employer/messages/files/45"]) {
            const expected = value.includes("admin-employer") ? "https://backend.example/api/admin-employer/messages/files/45" : "https://backend.example/api/messages/files/45";
            assert.equal(resolveFileUrl(value), expected);
            globalThis.fetch = async (url, options) => {
                assert.equal(url, expected);
                assert.equal(options.headers.Authorization, "Bearer fixture-token");
                return new Response("%PDF-attachment", { headers: { "Content-Type": "application/pdf" } });
            };
            assert.equal(await (await fetchFile(value, true)).text(), "%PDF-attachment");
        }
    } finally { globalThis.fetch = originalFetch; }
});

test("attachment fetch reports missing files, expired sessions and denied access clearly", async () => {
    const originalFetch = globalThis.fetch;
    try {
        for (const [status, message] of [[401, /session has expired/], [403, /not allowed/], [404, /could not be found/]]) {
            globalThis.fetch = async () => Response.json({ msg: "Stored file not found." }, { status });
            await assert.rejects(fetchFile("/api/messages/files/45", true), message);
        }
    } finally { globalThis.fetch = originalFetch; }
});

test("all messaging pages use protected file fetching and honor the download action", () => {
    for (const name of ["MessagesPage", "EmployerMessagesPage", "AdminAlumniMessagesPage", "AdminEmployerMessagesPage"]) {
        const source = readFileSync(new URL(`../src/pages/${name}.jsx`, import.meta.url), "utf8");
        const start = source.indexOf("const openAttachment");
        const handler = source.slice(start, start + 1600);
        assert.match(handler, /fetchFile\([^,]+, true\)/);
        assert.match(handler, /disposition === "download"/);
        assert.match(handler, /link\.download = message\.file_name/);
        assert.match(handler, /setError\(err\.message\)/);
        assert.doesNotMatch(handler, /API_BASE_URL/);
    }
});
