const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const db = require("../models");
const controller = require("../controllers/applicationController");

const storedResume = (originalName = "James_Tehiro_Resume.pdf") =>
    `cld:${Buffer.from(JSON.stringify({
        provider: "cloudinary", resourceType: "raw", type: "upload",
        publicId: "private_uploads/resumes/resume-123.pdf",
        url: "https://res.cloudinary.com/example/raw/upload/v1/private_uploads/resumes/resume-123.pdf",
        originalName
    })).toString("base64url")}`;

const application = (extra = {}) => ({
    id: 31, alumni_id: 7, status: "pending", Job: { id: 45, employer_id: 9 },
    resume_path: storedResume(), ...extra
});

const response = () => ({
    statusCode: 200, headers: {}, body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    setHeader(name, value) { this.headers[name] = value; },
    send(body) { this.body = body; return this; },
    sendFile(filePath) { this.filePath = filePath; return this; }
});

const invokeResume = async (user, row = application()) => {
    const originalFindByPk = db.Application.findByPk;
    db.Application.findByPk = async () => row;
    try {
        const res = response();
        await controller.getApplicationResumeFile({ user, params: { id: "31" } }, res, (error) => { throw error; });
        return res;
    } finally {
        db.Application.findByPk = originalFindByPk;
    }
};

test.after(async () => { await db.sequelize.close(); });

test("legacy resume metadata exposes saved original names and MIME types through both applicant lists", async () => {
    const originalFindAll = db.Application.findAll;
    const originalJobFind = db.Job.findByPk;
    const originalMax = db.Application.max;
    db.Job.findByPk = async () => ({ id: 45, employer_id: 9 });
    db.Application.max = async () => 1;
    const types = {
        pdf: "application/pdf", doc: "application/msword",
        docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png"
    };
    try {
        for (const [extension, mimeType] of Object.entries(types)) {
            const originalName = `${"Long original resume name ".repeat(7)}.${extension.toUpperCase()}`;
            db.Application.findAll = async () => [application({
                resume_path: storedResume(originalName),
                ApplicationDocuments: [{ id: 4, requirement_code: "transcript", file_name: "Transcript.pdf", mime_type: "application/pdf", file_path: "/uploads/documents/transcript.pdf" }]
            })];
            for (const user of [{ id: 9, role: "employer" }, { id: 12, role: "admin", admin_scope: "employer" }]) {
                for (const listMethod of ["getEmployerApplications", "getJobApplicants"]) {
                    const res = response();
                    await controller[listMethod]({ user, params: { jobId: "45" }, query: {} }, res, (error) => { throw error; });
                    assert.equal(res.body[0].resume_file_name, originalName);
                    assert.equal(res.body[0].resume_mime_type, mimeType);
                    assert.equal(res.body[0].resume_path, "/api/applications/31/resume/file");
                    assert.equal(res.body[0].ApplicationDocuments[0].file_name, "Transcript.pdf");
                    assert.equal(res.body[0].ApplicationDocuments[0].file_path, "/api/applications/31/documents/4/file");
                    assert.doesNotMatch(JSON.stringify(res.body), /res\.cloudinary\.com|private_uploads/);
                }
            }
        }
    } finally {
        db.Application.findAll = originalFindAll;
        db.Job.findByPk = originalJobFind;
        db.Application.max = originalMax;
    }
});

test("legacy records without original names or resumes remain readable", async () => {
    const originalFindAll = db.Application.findAll;
    db.Application.findAll = async () => [
        application({ resume_path: "C:\\Alumni\\backend\\uploads\\resumes\\resume-123.pdf" }),
        application({ resume_path: null })
    ];
    try {
        const res = response();
        await controller.getApplications({ user: { id: 7, role: "alumni" } }, res, (error) => { throw error; });
        assert.equal(res.body[0].resume_file_name, "resume-123.pdf");
        assert.equal(res.body[0].resume_mime_type, "application/pdf");
        assert.equal(res.body[0].resume_path, "/api/applications/31/resume/file");
        assert.doesNotMatch(res.body[0].resume_file_name, /[\\/]/);
        assert.equal(res.body[1].resume_file_name, null);
        assert.equal(res.body[1].resume_mime_type, null);
    } finally { db.Application.findAll = originalFindAll; }
});

test("resume reader allows the owning employer, Admin Employer, and applicant with private response headers", async () => {
    const originalFetch = global.fetch;
    let requested = 0;
    global.fetch = async () => {
        requested += 1;
        return { ok: true, headers: new Headers({ "content-type": "application/octet-stream" }), arrayBuffer: async () => Buffer.from("%PDF-test") };
    };
    try {
        for (const user of [{ id: 9, role: "employer" }, { id: 12, role: "admin", admin_scope: "employer" }, { id: 7, role: "alumni" }]) {
            const res = await invokeResume(user);
            assert.equal(res.statusCode, 200);
            assert.equal(res.headers["Content-Type"], "application/pdf");
            assert.equal(res.headers["Cache-Control"], "private, no-store");
            assert.equal(res.headers["X-Content-Type-Options"], "nosniff");
            assert.equal(res.body.toString(), "%PDF-test");
        }
        assert.equal(requested, 3);
    } finally { global.fetch = originalFetch; }
});

test("resume reader rejects unrelated employers, alumni, and other admin scopes before reading storage", async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => { throw new Error("Unauthorized requests must never fetch resume data"); };
    try {
        for (const user of [{ id: 99, role: "employer" }, { id: 99, role: "alumni" }, { id: 9, role: "admin", admin_scope: "alumni" }, { id: 9, role: "admin", admin_scope: "registrar" }, { id: 9, role: "admin" }]) {
            const res = await invokeResume(user);
            assert.equal(res.statusCode, 403);
            assert.equal(res.body.msg, "Not allowed to access this application document.");
        }
    } finally { global.fetch = originalFetch; }
});

test("resume reader supports old absolute upload paths and confines reads to uploads", async () => {
    const originalAccess = fs.promises.access;
    const accessed = [];
    fs.promises.access = async (filePath) => { accessed.push(filePath); };
    try {
        const res = await invokeResume({ id: 9, role: "employer" }, application({ resume_path: "C:\\old-server\\backend\\uploads\\resumes\\resume-123.pdf" }));
        assert.equal(res.filePath, path.resolve(__dirname, "..", "uploads", "resumes", "resume-123.pdf"));
        assert.equal(res.headers["Content-Type"], "application/pdf");
        for (const unsafePath of ["/uploads/../config/database.js", "C:\\private\\resume.pdf", "uploads/resumes/../../config/database.js"]) {
            const denied = await invokeResume({ id: 9, role: "employer" }, application({ resume_path: unsafePath }));
            assert.equal(denied.statusCode, 404);
            assert.equal(denied.filePath, undefined);
        }
        assert.equal(accessed.length, 1);
    } finally { fs.promises.access = originalAccess; }
});

test("resume reader handles missing applications, absent resumes, and missing stored files", async () => {
    assert.equal((await invokeResume({ id: 9, role: "employer" }, null)).statusCode, 404);
    assert.equal((await invokeResume({ id: 9, role: "employer" }, application({ resume_path: null }))).statusCode, 404);
    const originalAccess = fs.promises.access;
    fs.promises.access = async () => { throw new Error("ENOENT"); };
    try {
        const res = await invokeResume({ id: 9, role: "employer" }, application({ resume_path: "/uploads/resumes/missing.pdf" }));
        assert.equal(res.statusCode, 404);
        assert.equal(res.filePath, undefined);
    } finally { fs.promises.access = originalAccess; }
});

test("document reader binds the requested document to the authorized application", async () => {
    const originalFindByPk = db.Application.findByPk;
    const originalDocumentFind = db.ApplicationDocument.findOne;
    let lookup;
    db.Application.findByPk = async () => application();
    db.ApplicationDocument.findOne = async ({ where }) => { lookup = where; return null; };
    try {
        const res = response();
        await controller.getApplicationDocumentFile({ user: { id: 9, role: "employer" }, params: { id: "31", documentId: "101" } }, res, (error) => { throw error; });
        assert.deepEqual(lookup, { id: "101", application_id: 31 });
        assert.equal(res.statusCode, 404);
    } finally {
        db.Application.findByPk = originalFindByPk;
        db.ApplicationDocument.findOne = originalDocumentFind;
    }
});
