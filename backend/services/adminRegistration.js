const bcrypt = require("bcrypt");
const { fail } = require("./registrationOtp");
const { normalizeEmail, isGmail, emailKey, EMAIL_KEY_SQL } = require("../utils/registrationEmail");
const SCOPES = ["registrar", "alumni", "employer"];
const LIMIT_MESSAGE = "Admin account limit reached. The portal already has all three authorized administrator accounts.";
const scopeOf = row => String(row.admin_scope || "").trim().toLowerCase();
function availability(admins) {
    const complete = admins.length >= 3;
    const occupied = new Set(admins.map(scopeOf));
    return {
        adminCount: admins.length, maxAdmins: 3, setupComplete: complete,
        registrarAdminExists: occupied.has("registrar"), alumniAdminExists: occupied.has("alumni"), employerAdminExists: occupied.has("employer"),
        availableScopes: complete ? [] : SCOPES.filter(scope => !occupied.has(scope)),
        ...(complete ? { msg: LIMIT_MESSAGE } : {})
    };
}
function assertAvailable(admins, scope) {
    if (admins.length >= 3) throw fail(409, "ADMIN_LIMIT_REACHED", LIMIT_MESSAGE);
    if (!SCOPES.includes(scope)) throw fail(400, "INVALID_ADMIN_SCOPE", "Select a valid administrative role.");
    if (admins.some(row => scopeOf(row) === scope)) throw fail(409, "ADMIN_SCOPE_OCCUPIED", "This administrative role already has an account.");
}
function validateDetails(body) {
    const { password, admin_scope: scope } = body || {};
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const email = normalizeEmail(body?.email);
    if (!name || name.length > 255 || !isGmail(email) || typeof password !== "string" || password.length < 8 || Buffer.byteLength(password) > 72)
        throw fail(400, "INVALID_ADMIN_REGISTRATION", "Enter a name, valid @gmail.com address, and password of at least 8 characters and at most 72 bytes.");
    if (!SCOPES.includes(scope)) throw fail(400, "INVALID_ADMIN_SCOPE", "Select a valid administrative role.");
    return { name, email, password, scope };
}
function createAdminRegistration({ db, otp, hash = password => bcrypt.hash(password, 12) }) {
    const readAdmins = options => db.User.findAll({ where: { role: "admin" }, attributes: ["admin_scope"], ...options });
    return {
        status: async () => availability(await readAdmins()),
        check: async scope => assertAvailable(await readAdmins(), scope),
        validate: validateDetails,
        async create(body) {
            const { session_token, registration_authorization } = body || {};
            const { name, email, password, scope } = validateDetails(body);
            const hashed = await hash(password);
            for (let attempt = 0; attempt < 3; attempt++) {
                try {
                    // SERIALIZABLE + FOR UPDATE takes next-key locks over ALL admin
                    // rows (including pending/legacy scopes). Concurrent contenders
                    // either observe the committed account or deadlock and retry.
                    // The unique (role,admin_scope) index is a second constraint.
                    return await db.sequelize.transaction({ isolationLevel: "SERIALIZABLE" }, async transaction => {
                        assertAvailable(await readAdmins({ transaction, lock: transaction.LOCK.UPDATE }), scope);
                        const existing = await db.User.findOne({ where: db.Sequelize.where(db.Sequelize.literal(`(${EMAIL_KEY_SQL})`), emailKey(email)), attributes: ["id"], transaction });
                        if (existing) throw fail(409, "EMAIL_REGISTERED", "Gmail address is already registered, including pending accounts.");
                        const proof = await otp.consume(email, session_token, registration_authorization, transaction);
                        const user = await db.User.create({ name, email, password: hashed, role: "admin", admin_scope: scope,
                            account_status: "verified", email_verified_at: proof.verified_at }, { transaction });
                        await proof.update({ consumed_by_user_id: user.id }, { transaction });
                        return user;
                    });
                } catch (error) {
                    if (error.name === "SequelizeUniqueConstraintError") throw fail(409, "ADMIN_REGISTRATION_CONFLICT", "This administrative role or Gmail address already has an account. Refresh availability before trying again.");
                    const code = error.original?.code || error.parent?.code || error.code;
                    if (!["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"].includes(code)) throw error;
                    if (attempt === 2) throw fail(503, "ADMIN_REGISTRATION_BUSY", "Admin registration is busy. Please try again shortly.");
                }
            }
        }
    };
}
module.exports = { createAdminRegistration, availability, assertAvailable, validateDetails, SCOPES, LIMIT_MESSAGE };
