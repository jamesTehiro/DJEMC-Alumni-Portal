const fs = require("fs");
const path = require("path");

const roots = {
    uploads: path.resolve(__dirname, "..", "uploads"),
    private_uploads: path.resolve(__dirname, "..", "private_uploads")
};

const decodeOnce = (value) => {
    try { return decodeURIComponent(value); } catch { return null; }
};

// A stored reference is not a filesystem path supplied by the requester. Legacy
// absolute paths are mapped to the existing upload roots, never read directly.
const normalizeStoredPath = (value, depth = 0) => {
    if (depth > 3 || typeof value !== "string") return null;
    let source = value.trim();
    if (!source || source.includes("\0")) return null;
    if (source.startsWith("cld:")) return source;
    if (/^https?:\/\//i.test(source)) {
        let url;
        try { url = new URL(source); } catch { return null; }
        if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return source;
        source = url.pathname;
    }
    const secureMatch = source.match(/^\/?api\/files\/secure\/([A-Za-z0-9_-]+)(?:\?.*)?$/);
    if (secureMatch) {
        const decoded = Buffer.from(secureMatch[1], "base64url").toString("utf8");
        return normalizeStoredPath(decoded, depth + 1);
    }
    const legacyMatch = source.match(/^\/?api\/files\/([^/?]+)\/([^?]+)(?:\?.*)?$/);
    if (legacyMatch) source = `/uploads/${legacyMatch[1]}/${legacyMatch[2]}`;
    source = decodeOnce(source.replace(/\\/g, "/"));
    if (source === null || source.includes("\0")) return null;
    const match = source.match(/(?:^|\/)(uploads|private_uploads)\/(.+)$/i);
    if (!match) return null;
    const parts = match[2].split("/");
    if (parts.some((part) => !part || part === "." || part === ".." || /[\x00-\x1f:]/.test(part))) return null;
    return `/${match[1].toLowerCase()}/${parts.join("/")}`;
};

const sameStoredFile = (left, right) => {
    const a = normalizeStoredPath(left);
    const b = normalizeStoredPath(right);
    return !!a && !!b && a === b;
};

const resolveLocalStoredFile = async (value) => {
    const normalized = normalizeStoredPath(value);
    const match = normalized?.match(/^\/(uploads|private_uploads)\/(.+)$/);
    if (!match) return null;
    const root = roots[match[1]];
    const target = path.resolve(root, ...match[2].split("/"));
    if (!target.startsWith(`${root}${path.sep}`)) return null;
    try {
        const [realRoot, realTarget, stat] = await Promise.all([
            fs.promises.realpath(root), fs.promises.realpath(target), fs.promises.stat(target)
        ]);
        if (!stat.isFile() || !realTarget.startsWith(`${realRoot}${path.sep}`)) return null;
        await fs.promises.access(realTarget, fs.constants.R_OK);
        return realTarget;
    } catch { return null; }
};

const sanitizeDownloadName = (name) =>
    path.posix.basename(String(name || "file").replace(/\\/g, "/")).replace(/[\x00-\x1f\x7f"]/g, "_") || "file";

const setFileResponseHeaders = (res, name, attachment = false) => {
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (name) {
        const safeName = sanitizeDownloadName(name);
        const asciiName = safeName.replace(/[^\x20-\x7e]/g, "_");
        res.setHeader("Content-Disposition", `${attachment ? "attachment" : "inline"}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`);
    }
};

module.exports = { normalizeStoredPath, sameStoredFile, resolveLocalStoredFile, sanitizeDownloadName, setFileResponseHeaders };
