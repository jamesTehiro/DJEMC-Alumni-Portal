import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const bundle = buildSync({ entryPoints: [fileURLToPath(new URL("../src/utils/alumniDocuments.js", import.meta.url))], bundle: true, write: false, platform: "node", format: "cjs", define: { "import.meta.env": "{}" }, logLevel: "silent" });
const module = { exports: {} };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(require, module, module.exports);
const { validateAlumniDocuments, MAX_ALUMNI_DOCUMENT_MB } = module.exports;
const document = (index = 0) => ({ name: `Proof ${index}.pdf`, type: "application/pdf", size: 500 });

test("optional uploads and one through six valid files pass; seven fail", () => {
    for (let count = 0; count <= 6; count++) assert.equal(validateAlumniDocuments(Array.from({ length: count }, (_, index) => document(index))), "");
    assert.match(validateAlumniDocuments(Array.from({ length: 7 }, (_, index) => document(index))), /up to six/);
});

test("document types, MIME matches, nonempty and configured per-file size limits are enforced", () => {
    for (const [extension, type] of [["PDF", "application/pdf"], ["png", "image/png"], ["jpg", "image/jpeg"], ["jpeg", "image/jpeg"], ["doc", "application/msword"], ["docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"], ["webp", "image/webp"]]) {
        assert.equal(validateAlumniDocuments([{ name: `proof.${extension}`, type, size: MAX_ALUMNI_DOCUMENT_MB * 1024 * 1024 }]), "");
    }
    for (const file of [{ ...document(), name: "proof.pdf.exe" }, { ...document(), type: "image/png" }, { ...document(), name: "proof.txt", type: "text/plain" }]) assert.match(validateAlumniDocuments([file]), /Documents must be/);
    for (const size of [0, MAX_ALUMNI_DOCUMENT_MB * 1024 * 1024 + 1]) assert.match(validateAlumniDocuments([{ ...document(), size }]), /non-empty and no larger/);
    assert.equal(validateAlumniDocuments([{ ...document(), type: "" }]), "");
});
