const db = require("../models");
const { getStoredFileOriginalName } = require("../services/objectStorage");
const { MAX_PERMITS, fileMetadata, readPermitDocuments, permitDocumentPayload, inferMime } = require("../services/employerPermitDocuments");
const { normalizeStoredPath, resolveLocalStoredFile, setFileResponseHeaders } = require("../utils/storedFiles");
const { isStoredFileReference, parseStoredFileReference, recoverPermitStoredFileReference, streamStoredFile } = require("../services/objectStorage");

exports.getDocument = async (req, res, next) => {
    try {
        if (req.user?.role !== "admin" || req.user.admin_scope !== "employer") return res.status(403).json({ msg: "Employer admin access required." });
        const { userId, documentId } = req.params;
        if (!/^[1-9]\d*$/.test(String(userId)) || !/^(original|[1-5])$/.test(String(documentId))) return res.status(404).json({ msg: "Business permit document not found." });
        const user = await db.User.findByPk(userId, { attributes: ["id", "role"] });
        if (!user || user.role !== "employer") return res.status(404).json({ msg: "Employer not found." });
        const profile = await db.EmployerProfile.findOne({ where: { user_id: user.id }, attributes: { include: ["business_permit_documents"] } });
        const documents = readPermitDocuments(profile);
        const document = documentId === "original" ? documents.find(item => item.storage_ref === profile?.business_permit_path) : documents.find(item => item.id === documentId);
        const missing = () => {
            res.removeHeader("Content-Disposition"); res.removeHeader("Content-Type");
            return res.status(404).json({ msg: "The submitted business permit document could not be found. It may no longer be available." });
        };
        if (!document) return missing();
        let reference = document.storage_ref;
        if (reference.startsWith("cld:") && !isStoredFileReference(reference)) reference = await recoverPermitStoredFileReference(reference);
        if (!reference) return missing();
        let mime = document.mime_type;
        let name = document.name;
        if (mime === "application/octet-stream") {
            const parsed = parseStoredFileReference(reference);
            const assetName = parsed?.publicId || reference;
            mime = inferMime(assetName);
            if (!/\.(pdf|png|jpe?g|webp|gif)$/i.test(name)) name = getStoredFileOriginalName(reference) || name + require("path").extname(assetName);
        }
        setFileResponseHeaders(res, name, req.query?.download === "1");
        if (isStoredFileReference(reference) || /^https?:\/\//i.test(reference) && new URL(reference).hostname === "res.cloudinary.com") {
            // Authenticated/private permits require Cloudinary's signed
            // private-download API. Keep legacy public-upload references on
            // their original server-side retrieval path.
            const storedAsset = parseStoredFileReference(reference);
            const privateAsset = ["authenticated", "private"].includes(storedAsset?.type);
            try { return await streamStoredFile(reference, res, mime === "application/octet-stream" ? null : mime, privateAsset); }
            catch (error) {
                res.removeHeader("Content-Type"); res.removeHeader("Content-Disposition");
                if (error.status === 404) return missing();
                // Keep private URLs, public IDs, and provider credentials out of
                // Render logs while retaining the signal needed to diagnose a
                // denied signature, provider outage, or network failure.
                console.error("[employer-permit-storage] Cloudinary delivery failed", {
                    upstreamStatus: Number.isInteger(error.status) ? error.status : null,
                    failure: Number.isInteger(error.status) ? "provider_response" : "network_or_signing"
                });
                throw Object.assign(new Error("Business permit storage is temporarily unavailable. Please try again later."), { status: 502, publicMessage: "Business permit storage is temporarily unavailable. Please try again later." });
            }
        }
        if (/^https?:\/\//i.test(reference)) reference = new URL(reference).pathname;
        if (/^file:\/\//i.test(reference)) reference = reference.replace(/^file:\/\//i, "");
        if (/^[^/\\]+$/.test(reference)) reference = `/uploads/documents/${encodeURIComponent(reference)}`;
        const localValue = reference.replace(/%(?![0-9a-f]{2})/gi, "%25");
        const normalized = normalizeStoredPath(localValue);
        if (!/^\/(uploads\/(documents|business-permits)|private_uploads\/business_permits)\//.test(normalized || "")) return missing();
        const local = await resolveLocalStoredFile(localValue);
        if (!local) return missing();
        res.setHeader("Content-Type", mime || "application/octet-stream");
        return res.sendFile(local);
    } catch (error) { next(error); }
};
exports.replacePermit = async (req, res, next) => {
    try {
        if (req.user?.role !== "admin" || req.user.admin_scope !== "employer") return res.status(403).json({ msg: "Employer admin access required." });
        const files = req.files?.business_permit || [];
        if (!files.length || files.length > MAX_PERMITS) return res.status(400).json({ msg: "Select one to five valid business permit files." });
        const profile = await db.sequelize.transaction(async transaction => {
            const user = await db.User.findByPk(req.params.userId, { transaction });
            if (!user || user.role !== "employer") { const error = new Error("Employer not found."); error.status = 404; throw error; }
            const profile = await db.EmployerProfile.findOne({ where: { user_id: user.id }, attributes: { include: ["business_permit_documents"] }, transaction, lock: transaction.LOCK?.UPDATE });
            if (!profile) { const error = new Error("Employer profile not found."); error.status = 404; throw error; }
            const existing = readPermitDocuments(profile);
            if (existing.length + files.length > MAX_PERMITS) throw Object.assign(new Error("An employer can have at most five business permit documents."), { status: 400 });
            const documents = JSON.stringify([...existing.map(({ id, ...document }) => document), ...files.map(fileMetadata)]);
            const original = profile.business_permit_path || files.map(fileMetadata)[0].storage_ref;
            await profile.update({ business_permit_path: original, business_permit_documents: documents }, { transaction });
            await profile.reload({ transaction, attributes: { include: ["business_permit_documents"] } });
            if (profile.business_permit_documents !== documents || profile.business_permit_path !== original) throw new Error("Business permit could not be saved.");
            return profile;
        });
        const documents = permitDocumentPayload(profile, profile.user_id || req.params.userId);
        res.json({ msg: "Business permit documents saved. Verification status is unchanged.", business_permit_path: documents[0]?.url || null, business_permit_name: documents[0]?.name || null, business_permit_documents: documents });
    } catch (error) { next(error); }
};
