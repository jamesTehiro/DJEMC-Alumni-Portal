const test = require("node:test");
const assert = require("node:assert/strict");
const { run } = require("../scripts/applyAlumniProofDocumentsMigration");

test("alumni proof documents migration refuses apply without the explicit target", async () => {
    await assert.rejects(run(["--apply"], () => {}, {}), /requires explicit --database and --host/);
    await assert.rejects(run(["--apply", "--database", "defaultdb"], () => {}, {}), /requires explicit --database and --host/);
});

test("alumni proof documents migration rejects unknown and malformed arguments", async () => {
    await assert.rejects(run(["--force"], () => {}, {}), /Unsupported arguments/);
    await assert.rejects(run(["--host"], () => {}, {}), /--host requires a value/);
});
