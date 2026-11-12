"use strict";

const db = require("../models");
const { parseStoredFileReference, streamStoredFile } = require("../services/objectStorage");
const { normalizeStoredPath, resolveLocalStoredFile, setFileResponseHeaders } = require("../utils/storedFiles");

const TYPES = new Set(["signature", "seal", "authorization_pdf"]);
const DOCUMENTS = {
    signature: { fallbackName: "authorized-representative-signature" },
    seal: { fallbackName: "government-agency-seal" },
    authorization_pdf: { mime: "application/pdf", fallbackName: "government-agency-registration-authorization.pdf" }
};

const notFound = res => res.status(404).json({ msg: "The submitted government agency document could not be found." });

exports.getDocument = async (req, res, next) => {
    try {
        if (req.user?.role !== "admin" || req.user.admin_scope !== "employer") {
            return res.status(403).json({ msg: "Employer admin access required." });
        }
        const { userId, documentType } = req.params;
        if (!/^[1-9]\d*$/.test(String(userId)) || !TYPES.has(documentType)) return notFound(res);
        const user = await db.User.findOne({ where: { id: userId, role: "employer" }, attributes: ["id"] });
        if (!user) return notFound(res);
        const profile = await db.EmployerProfile.findOne({
            where: { user_id: user.id },
            attributes: { include: ["organization_type", "government_agency_documents"] }
        });
        if (!profile || profile.organization_type !== "government_agency") return notFound(res);
        let documents = profile.government_agency_documents;
        if (typeof documents === "string") {
            try { documents = JSON.parse(documents); } catch { return notFound(res); }
        }
        const document = documents?.[documentType];
        const reference = document?.storage_ref;
        if (typeof reference !== "string" || !reference) return notFound(res);

        const download = req.query?.download === "1";
        const definition = DOCUMENTS[documentType];
        const mime = definition.mime || (["image/png", "image/jpeg"].includes(document.mime_type) ? document.mime_type : null);
        if (!mime) return notFound(res);
        const name = document.name || `${definition.fallbackName}.${mime === "image/jpeg" ? "jpg" : mime === "image/png" ? "png" : "pdf"}`;
        setFileResponseHeaders(res, name, download);
        res.setHeader("Content-Type", mime);

        if (reference.startsWith("cld:")) {
            const stored = parseStoredFileReference(reference);
            const publicIdParts = stored?.publicId?.split("/") || [];
            if (!stored || stored.provider !== "cloudinary" || stored.type !== "authenticated" ||
                publicIdParts[0] !== "private_uploads" || publicIdParts[1] !== "government_agencies" ||
                publicIdParts.length < 3 || publicIdParts.some(part => !part || part === "." || part === "..") ||
                (documentType === "authorization_pdf" ? stored.resourceType !== "raw" : stored.resourceType !== "image")) {
                res.removeHeader("Content-Type");
                res.removeHeader("Content-Disposition");
                return notFound(res);
            }
            try { return await streamStoredFile(reference, res, mime, true); }
            catch (error) {
                res.removeHeader("Content-Type");
                res.removeHeader("Content-Disposition");
                if (error.status === 404) return notFound(res);
                console.error("[government-agency-document-storage] Private document delivery failed.", {
                    upstreamStatus: Number.isInteger(error.status) ? error.status : null
                });
                throw Object.assign(new Error("Government agency document storage is temporarily unavailable."), { status: 502 });
            }
        }

        const normalized = normalizeStoredPath(reference);
        if (!normalized?.startsWith("/private_uploads/government_agencies/")) {
            res.removeHeader("Content-Type");
            res.removeHeader("Content-Disposition");
            return notFound(res);
        }
        const localPath = await resolveLocalStoredFile(normalized);
        if (!localPath) {
            res.removeHeader("Content-Type");
            res.removeHeader("Content-Disposition");
            return notFound(res);
        }
        return res.sendFile(localPath);
    } catch (error) {
        return next(error);
    }
};
