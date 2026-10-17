const path = require("path");
const { parseStoredFileReference, getStoredFileOriginalName } = require("./objectStorage");
const { sanitizeDownloadName } = require("../utils/storedFiles");

const MAX_PERMITS = 5;
const inferMime = name => ({ ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".pdf": "application/pdf", ".webp": "image/webp", ".gif": "image/gif" }[path.extname(name || "").toLowerCase()] || "application/octet-stream");
const fileMetadata = file => {
    const storage_ref = file.storageRef || (file.filename ? `/uploads/documents/${file.filename}` : null);
    if (!storage_ref) throw new Error("Business permit storage did not return a file reference. Registration was not completed.");
    return { storage_ref, name: sanitizeDownloadName(file.originalname || file.filename), mime_type: file.mimetype, size: file.size || null };
};
const readPermitDocuments = profile => {
    if (!profile) return [];
    let documents = profile.business_permit_documents || null;
    if (typeof documents === "string" && documents) {
        try { documents = JSON.parse(documents); }
        catch { throw new Error("Stored business permit document metadata could not be read."); }
    }
    if (documents != null && !Array.isArray(documents)) throw new Error("Stored business permit document metadata could not be read.");
    const result = (documents || []).map((document, index) => {
        if (!document || typeof document.storage_ref !== "string" || !document.storage_ref) throw new Error("Stored business permit document metadata is incomplete.");
        return { ...document, id: String(index + 1), name: sanitizeDownloadName(document.name || "Business permit"), mime_type: document.mime_type || inferMime(document.name) };
    });
    const original = profile.business_permit_path;
    if (original && !result.some(document => document.storage_ref === original)) {
        const parsed = parseStoredFileReference(original);
        const partialId = String(original).startsWith("cld:") ? Buffer.from(String(original).slice(4), "base64url").toString("utf8").match(/"publicId":"([A-Za-z0-9._/-]+)"/)?.[1] : null;
        const source = parsed?.publicId || partialId || (!String(original).startsWith("cld:") ? String(original).replace(/\\/g, "/").split("?")[0] : "");
        let name = getStoredFileOriginalName(original) || path.posix.basename(source) || "Business permit submitted at registration";
        try { name = decodeURIComponent(name); } catch { /* Keep a literal filename. */ }
        result.unshift({ id: "original", storage_ref: original, name: sanitizeDownloadName(name), mime_type: inferMime(name), size: null });
    }
    return result;
};
const permitDocumentPayload = (profile, userId) => readPermitDocuments(profile).map(document => ({
    id: document.id, name: document.name, mime_type: document.mime_type, size: document.size,
    url: `/api/admin/employer/users/${encodeURIComponent(userId)}/business-permits/${document.id}`
}));
module.exports = { MAX_PERMITS, inferMime, fileMetadata, readPermitDocuments, permitDocumentPayload };
