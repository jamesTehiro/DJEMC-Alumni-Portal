import { MAX_BUSINESS_PERMIT_MB } from "./businessPermits";

export const MAX_ALUMNI_DOCUMENT_FILES = 6;
export const MAX_ALUMNI_DOCUMENT_MB = MAX_BUSINESS_PERMIT_MB;
export const ALUMNI_DOCUMENT_ACCEPT = ".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp";

export function validateAlumniDocuments(files) {
    if (files.length > MAX_ALUMNI_DOCUMENT_FILES) return "You can upload up to six proof of graduation files.";
    const types = { pdf: "application/pdf", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };
    for (const file of files) {
        const mime = types[String(file.name || "").split(".").pop().toLowerCase()];
        if (!mime || file.type && file.type !== mime) return "Documents must be PDF, DOC, DOCX, PNG, JPG, JPEG, or WEBP files.";
        if (!file.size || file.size > MAX_ALUMNI_DOCUMENT_MB * 1024 * 1024) return `Each document must be non-empty and no larger than ${MAX_ALUMNI_DOCUMENT_MB} MB.`;
    }
    return "";
}
