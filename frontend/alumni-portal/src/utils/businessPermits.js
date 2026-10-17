export const MAX_BUSINESS_PERMIT_FILES = 5;
const configuredMb = Number(import.meta.env.VITE_MAX_UPLOAD_MB || import.meta.env.VITE_MAX_ATTACHMENT_MB || 10);
export const MAX_BUSINESS_PERMIT_MB = Number.isFinite(configuredMb) && configuredMb > 0 ? configuredMb : 10;
export const BUSINESS_PERMIT_ACCEPT = ".png,.jpg,.jpeg,.pdf";

export function validateBusinessPermits(files, required = true) {
    if (required && !files.length) return "Select at least one business permit document.";
    if (files.length > MAX_BUSINESS_PERMIT_FILES) return "You can upload up to five business permit files.";
    for (const file of files) {
        const extension = String(file.name || "").split(".").pop().toLowerCase();
        const mime = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", pdf: "application/pdf" }[extension];
        if (!mime || file.type && file.type !== mime) return "Business permits must be PNG, JPG, JPEG, or PDF files.";
        if (!file.size || file.size > MAX_BUSINESS_PERMIT_MB * 1024 * 1024) return `Each business permit must be non-empty and no larger than ${MAX_BUSINESS_PERMIT_MB} MB.`;
    }
    return "";
}

export function getBusinessPermitDocuments(profile) {
    if (Array.isArray(profile?.business_permit_documents)) return profile.business_permit_documents;
    if (!profile?.business_permit_path) return [];
    return [{ id: "original", name: profile.business_permit_name || "Business permit submitted at registration", mime_type: "application/octet-stream", url: profile.business_permit_path }];
}
