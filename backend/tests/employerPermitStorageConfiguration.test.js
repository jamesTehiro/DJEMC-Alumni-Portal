const test = require("node:test");
const assert = require("node:assert/strict");
process.env.OBJECT_STORAGE_PROVIDER = "local";
process.env.NODE_ENV = "production";
process.env.RENDER = "true";
const express = require("express");
const { employerRegistrationUpload } = require("../middleware/uploadMiddleware");

test("Render rejects permit uploads when shared object storage is not configured", async () => {
    const app = express();
    app.post("/register", employerRegistrationUpload, (_req, res) => res.sendStatus(201));
    app.use((error, _req, res, _next) => res.status(error.status || 500).json({ msg: error.publicMessage || error.message }));
    const server = await new Promise(resolve => { const listening = app.listen(0, "127.0.0.1", () => resolve(listening)); });
    try {
        const form = new FormData();
        form.append("business_permit", new Blob([Buffer.from("%PDF-1.7 fixture")], { type: "application/pdf" }), "permit.pdf");
        const response = await fetch(`http://127.0.0.1:${server.address().port}/register`, { method: "POST", body: form });
        assert.equal(response.status, 503);
        assert.match((await response.json()).msg, /Business permit storage is unavailable/);
    } finally {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
});
