const jwt = require("jsonwebtoken");
const db = require("../models");

const extractToken = (authorizationHeader = "") => {
    if (!authorizationHeader) return null;

    // Accept both "Bearer <token>" and raw tokens (for backwards compatibility)
    const parts = authorizationHeader.split(" ");
    if (parts.length === 2 && /^Bearer$/i.test(parts[0])) {
        return parts[1].trim();
    }

    return authorizationHeader.trim() || null;
};

module.exports = async (req, res, next) => {
    const rawHeader = req.headers.authorization || req.headers.Authorization;
    const token = extractToken(rawHeader);

    if (!token) {
        return res.status(401).json({ msg: "No token provided" });
    }

    if (!process.env.JWT_SECRET) {
        return res.status(500).json({ msg: "JWT secret not configured" });
    }

    let decoded;
    try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
        return res.status(403).json({ msg: "Invalid or expired token" });
    }

    if (!decoded?.id) {
        return res.status(401).json({ msg: "Session is no longer valid." });
    }

    let account;
    try {
        account = await db.User.findByPk(decoded.id, {
            attributes: ["id", "role", "admin_scope", "account_status"]
        });
    } catch (err) {
        console.error("[AUTH_ACCOUNT_LOOKUP_ERR]", err?.name || "DatabaseError");
        return res.status(503).json({ msg: "Authentication is temporarily unavailable. Please try again." });
    }

    if (!account) {
        return res.status(401).json({ msg: "Session is no longer valid." });
    }

    if (["deactivated", "suspended", "inactive"].includes(String(account.account_status || "").toLowerCase())) {
        return res.status(403).json({ msg: "This account is inactive. Contact an administrator for help." });
    }

    // Database state is authoritative so role or scope changes also take effect
    // immediately for tokens issued before the change.
    req.user = {
        ...decoded,
        id: account.id,
        role: account.role,
        admin_scope: account.admin_scope,
        account_status: account.account_status
    };
    return next();
};
