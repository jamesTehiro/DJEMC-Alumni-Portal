const test = require("node:test");
const assert = require("node:assert/strict");

const db = require("../models");
const profilePreviewController = require("../controllers/profilePreviewController");
const profileController = require("../controllers/profileController");

const response = () => ({
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = JSON.parse(JSON.stringify(body)); return this; }
});

const withOverrides = async (overrides, run) => {
    const originals = overrides.map(([target, values]) => [target,
        Object.fromEntries(Object.keys(values).map((key) => [key, target[key]]))
    ]);
    for (const [target, values] of overrides) Object.assign(target, values);
    try {
        await run();
    } finally {
        for (const [target, values] of originals) Object.assign(target, values);
    }
};

test.after(async () => { await db.sequelize.close(); });

const employmentHistory = {
    id: 41,
    company_name: "Example Company",
    position: "Designer",
    start_year: 2020,
    end_year: 2024,
    employment_type: "Full-time"
};

const alumni = (visibility = "public") => ({
    id: 12,
    name: "Example Alum",
    role: "alumni",
    email: "private@example.invalid",
    password: "private password hash",
    admin_scope: "private scope",
    admin_department: "private department",
    admin_avatar_url: "/private-admin-photo.png",
    account_status: "verified",
    AlumniProfile: {
        avatar_url: "/alumni-photo.png",
        profile_visibility: visibility,
        phone: "+63 private phone",
        address: "Private residential address",
        course: "Private degree",
        graduation_year: 2019,
        employment_status: "employed",
        current_company: "Private current company",
        job_title: "Private current position",
        proof_document_path: "/private-document.pdf",
        EmploymentHistories: [{ ...employmentHistory, alumni_id: 99, internal_note: "private metadata" }]
    },
    EmployerProfile: {
        logo_url: "/employer-photo.png",
        organization_name: "Private organization",
        industry: "Private industry",
        address: "Private employer address",
        phone: "Private employer phone"
    }
});

const expectedAlumniPreview = (isPrivate = false) => ({
    id: 12,
    name: "Example Alum",
    role: "alumni",
    isPrivate,
    AlumniProfile: {
        avatar_url: "/alumni-photo.png",
        EmploymentHistories: isPrivate ? [] : [employmentHistory]
    },
    EmployerProfile: null
});

const getPreview = async (target, viewer = { id: 22, role: "alumni" }, application = null) => {
    const queries = [];
    let applicationQuery;
    let res;
    await withOverrides([
        [db.User, { findByPk: async (id, options) => {
            queries.push({ id, options });
            return options?.include ? target : viewer;
        } }],
        [db.Application, { findOne: async (options) => {
            applicationQuery = options;
            return application;
        } }]
    ], async () => {
        res = response();
        await profilePreviewController.getProfilePreview({
            params: { userId: String(target.id) }, user: { id: viewer.id }
        }, res);
    });
    return { res, queries, applicationQuery };
};

test("public alumni previews return only identity, photo and allowlisted employment history for every viewer", async () => {
    for (const viewer of [
        { id: 22, role: "alumni" },
        { id: 12, role: "alumni" },
        { id: 5, role: "admin" }
    ]) {
        const { res, queries } = await getPreview(alumni(), viewer);
        assert.equal(res.statusCode, 200);
        assert.deepEqual(res.body, expectedAlumniPreview());
        assert.deepEqual(queries[0].options.attributes, ["id", "role"]);
        assert.deepEqual(queries[1].options.attributes, ["id", "name", "role", "admin_avatar_url"]);
        const [alumniInclude, employerInclude] = queries[1].options.include;
        assert.equal(alumniInclude.model, db.AlumniProfile);
        assert.deepEqual(alumniInclude.attributes, ["avatar_url", "profile_visibility"]);
        assert.deepEqual(alumniInclude.include[0].attributes, Object.keys(employmentHistory));
        assert.deepEqual(employerInclude.attributes, ["logo_url"]);
    }
});

test("private, missing and unknown visibility hides employment history even for self and administrators", async () => {
    for (const visibility of ["private", null, undefined, "", "unknown"]) {
        const target = alumni(visibility);
        target.AlumniProfile.profile_visibility = visibility;
        for (const viewer of [
            { id: 22, role: "alumni" },
            { id: 12, role: "alumni" },
            { id: 5, role: "admin" }
        ]) {
            const { res } = await getPreview(target, viewer);
            assert.equal(res.statusCode, 200);
            assert.deepEqual(res.body, expectedAlumniPreview(true));
        }
    }
    const { res } = await getPreview(alumni(" PUBLIC "));
    assert.deepEqual(res.body, expectedAlumniPreview());
});

test("employer previews keep the application access rule and expose the same restricted alumni payload", async () => {
    const viewer = { id: 30, role: "employer" };
    const denied = await getPreview(alumni(), viewer);
    assert.equal(denied.res.statusCode, 403);
    assert.deepEqual(denied.applicationQuery.where, { alumni_id: 12 });
    assert.deepEqual(denied.applicationQuery.include[0].where, { employer_id: 30 });

    for (const visibility of ["public", "private"]) {
        const { res } = await getPreview(alumni(visibility), viewer, { id: 80 });
        assert.equal(res.statusCode, 200);
        assert.deepEqual(res.body, expectedAlumniPreview(visibility !== "public"));
    }
});

test("admin and employer previews return their photo without contact, organization or administrative details", async () => {
    for (const role of ["admin", "employer", "registrar"]) {
        const { res } = await getPreview({ ...alumni(), role });
        const expected = {
            id: 12, name: "Example Alum", role, isPrivate: false,
            AlumniProfile: null,
            EmployerProfile: role === "employer" ? { logo_url: "/employer-photo.png" } : null
        };
        if (role === "admin") expected.admin_avatar_url = "/private-admin-photo.png";
        assert.equal(res.statusCode, 200);
        assert.deepEqual(res.body, expected);
    }
});

test("an alumni preview without a profile returns no employment history", async () => {
    const { res } = await getPreview({ ...alumni(), AlumniProfile: null });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { ...expectedAlumniPreview(true), AlumniProfile: null });
});

test("preview rejects invalid ids and missing authentication before reading profile data", async () => {
    await withOverrides([
        [db.User, { findByPk: async () => { throw new Error("Unexpected database read"); } }]
    ], async () => {
        for (const userId of ["0", "-1", "1.5", "not-an-id", "Infinity", "9007199254740992"]) {
            const res = response();
            await profilePreviewController.getProfilePreview({ params: { userId }, user: { id: 22 } }, res);
            assert.equal(res.statusCode, 400);
        }
        const res = response();
        await profilePreviewController.getProfilePreview({ params: { userId: "12" } }, res);
        assert.equal(res.statusCode, 401);
    });
});

test("preview returns authorization and not-found errors without exposing internal failure details", async () => {
    for (const [findByPk, expectedCode] of [
        [async () => null, 401],
        [async (id, options) => options?.include ? null : { id: 22, role: "alumni" }, 404],
        [async () => { throw new Error("private@example.invalid SELECT private_column"); }, 500]
    ]) {
        await withOverrides([[db.User, { findByPk }]], async () => {
            const res = response();
            await profilePreviewController.getProfilePreview({ params: { userId: "12" }, user: { id: 22 } }, res);
            assert.equal(res.statusCode, expectedCode);
            if (expectedCode === 500) assert.deepEqual(res.body, { msg: "Unable to load profile preview." });
        });
    }
});

test("separate self, administrator and eligible employer profile endpoints retain full profile details", async () => {
    const target = alumni("private");
    await withOverrides([
        [db.User, { findByPk: async () => target }]
    ], async () => {
        const res = response();
        await profileController.getProfile({ user: { id: 12 } }, res);
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.email, target.email);
        assert.equal(res.body.AlumniProfile.phone, target.AlumniProfile.phone);
        assert.deepEqual(res.body.AlumniProfile.EmploymentHistories, target.AlumniProfile.EmploymentHistories);
    });

    for (const [viewer, visibility] of [
        [{ id: 12, role: "alumni" }, "private"],
        [{ id: 5, role: "admin" }, "private"],
        [{ id: 30, role: "employer" }, "public"]
    ]) {
        const fullTarget = alumni(visibility);
        await withOverrides([
            [db.User, { findByPk: async (id, options) => options?.include ? fullTarget : viewer }],
            [db.Application, { findOne: async () => ({ id: 80 }) }]
        ], async () => {
            const res = response();
            await profileController.getUserProfileById({ params: { userId: "12" }, user: { id: viewer.id } }, res);
            assert.equal(res.statusCode, 200);
            assert.equal(res.body.email, fullTarget.email);
            assert.equal(res.body.AlumniProfile.address, fullTarget.AlumniProfile.address);
            assert.deepEqual(res.body.AlumniProfile.EmploymentHistories, fullTarget.AlumniProfile.EmploymentHistories);
        });
    }
});
