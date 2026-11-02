const { environment } = require("../config/adminOtpEnvironment");
const { isPlaceholder } = require("../services/adminOtpConfiguration");
const db = require("../models");
const crypto = require("crypto");
const REQUIRED_ADMIN_SCOPES = ["registrar", "employer", "alumni"];

const getProvidedSecret = (req) =>
    req.headers["x-bootstrap-secret"] ||
    req.body?.bootstrap_secret ||
    "";

module.exports = async (req, res, next) => {
    const ip = req.ip || req.connection?.remoteAddress || "unknown";
    const secret = String(getProvidedSecret(req) || "").trim();
    const configuredSecret = String(environment.get().ADMIN_BOOTSTRAP_SECRET || "").trim();

    // eslint-disable-next-line no-console
    console.warn(
        `[bootstrap-attempt] ${new Date().toISOString()} ${req.method} ${String(req.path || "admin-setup").split("?")[0]} ip=${ip}`
    );

    let admins;
    try {
        admins = await db.User.findAll({
            where: { role: "admin" },
            attributes: ["admin_scope"]
        });
    } catch (error) { return next(error); }
    const existingScopes = new Set(
        admins
            .map((admin) => String(admin.admin_scope || "").trim().toLowerCase())
            .filter(Boolean)
    );
    const allAdminScopesConfigured = REQUIRED_ADMIN_SCOPES.every((scope) => existingScopes.has(scope));

    if (req.method === "GET" && (allAdminScopesConfigured || admins.length >= 3)) {
        return next();
    }

    if (admins.length >= 3) {
        return res.status(409).json({ code: "ADMIN_LIMIT_REACHED", msg: require("../services/adminRegistration").LIMIT_MESSAGE });
    }

    if (!configuredSecret || isPlaceholder(configuredSecret)) {
        return res.status(503).json({ code: "ADMIN_BOOTSTRAP_UNAVAILABLE", msg: "Admin registration is unavailable because the bootstrap secret is missing or invalid." });
    }

    const hash = value => crypto.createHash("sha256").update(value).digest();
    if (!secret || !crypto.timingSafeEqual(hash(secret), hash(configuredSecret))) {
        return res.status(403).json({ msg: "Invalid bootstrap secret." });
    }

    return next();
};
