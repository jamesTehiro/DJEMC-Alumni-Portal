const test = require("node:test");
const assert = require("node:assert/strict");
const modelPath = require.resolve("../models");
const controllerPath = require.resolve("../controllers/alumniRecordController");

function loadController({ recordExists = true, linkedAccounts = 0, failDestroy = false } = {}) {
    const calls = { findByPk: [], count: [], destroy: 0, committed: 0, rolledBack: 0 };
    const transaction = {
        LOCK: { UPDATE: "UPDATE" },
        finished: null,
        async commit() { calls.committed += 1; this.finished = "commit"; },
        async rollback() { calls.rolledBack += 1; this.finished = "rollback"; }
    };
    const fakeDb = {
        sequelize: { async transaction() { return transaction; } },
        AlumniRecord: {
            async findByPk(...args) {
                calls.findByPk.push(args);
                if (!recordExists) return null;
                return {
                    async destroy(options) {
                        assert.equal(options.transaction, transaction);
                        calls.destroy += 1;
                        if (failDestroy) throw new Error("database detail");
                    }
                };
            }
        },
        User: { async count(options) { calls.count.push(options); return linkedAccounts; } }
    };
    const oldModelModule = require.cache[modelPath];
    const oldControllerModule = require.cache[controllerPath];
    require.cache[modelPath] = { id: modelPath, filename: modelPath, loaded: true, exports: fakeDb };
    delete require.cache[controllerPath];
    const controller = require(controllerPath);
    return {
        controller,
        calls,
        restore() {
            delete require.cache[controllerPath];
            if (oldControllerModule) require.cache[controllerPath] = oldControllerModule;
            if (oldModelModule) require.cache[modelPath] = oldModelModule;
            else delete require.cache[modelPath];
        }
    };
}

function responseCapture() {
    return {
        statusCode: 200,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; }
    };
}

test("registrar alumni record deletion is scoped and preserves linked accounts", async (t) => {
    await t.test("deletes only the selected primary key after the dependency check", async () => {
        const fixture = loadController();
        const originalLog = console.log;
        try {
            console.log = () => {};
            const res = responseCapture();
            await fixture.controller.deleteAlumniRecord({ params: { id: "42" } }, res);
            assert.equal(res.statusCode, 200);
            assert.equal(res.body.success, true);
            assert.equal(fixture.calls.findByPk[0][0], 42);
            assert.equal(fixture.calls.findByPk[0][1].lock, "UPDATE");
            assert.deepEqual(fixture.calls.count[0].where, { alumni_record_id: 42 });
            assert.equal(fixture.calls.destroy, 1);
            assert.equal(fixture.calls.committed, 1);
        } finally {
            console.log = originalLog;
            fixture.restore();
        }
    });

    await t.test("returns 404 for missing records and 409 for registered accounts", async () => {
        for (const [options, expectedStatus, expectedDestroy] of [
            [{ recordExists: false }, 404, 0],
            [{ linkedAccounts: 1 }, 409, 0]
        ]) {
            const fixture = loadController(options);
            try {
                const res = responseCapture();
                await fixture.controller.deleteAlumniRecord({ params: { id: "42" } }, res);
                assert.equal(res.statusCode, expectedStatus);
                assert.equal(fixture.calls.destroy, expectedDestroy);
                assert.equal(fixture.calls.rolledBack, 1);
            } finally {
                fixture.restore();
            }
        }
    });

    await t.test("rejects invalid IDs and hides database errors", async () => {
        let fixture = loadController();
        try {
            const res = responseCapture();
            await fixture.controller.deleteAlumniRecord({ params: { id: "1.5" } }, res);
            assert.equal(res.statusCode, 400);
            assert.equal(fixture.calls.findByPk.length, 0);
        } finally {
            fixture.restore();
        }

        fixture = loadController({ failDestroy: true });
        const originalError = console.error;
        try {
            console.error = () => {};
            const res = responseCapture();
            await fixture.controller.deleteAlumniRecord({ params: { id: "42" } }, res);
            assert.equal(res.statusCode, 500);
            assert.equal(res.body.msg, "Unable to delete alumni record. Please try again.");
            assert.equal(fixture.calls.rolledBack, 1);
            assert.doesNotMatch(JSON.stringify(res.body), /database detail/);
        } finally {
            console.error = originalError;
            fixture.restore();
        }
    });
});
