// Keep VITE_MAX_ATTACHMENT_MB aligned with the backend MAX_UPLOAD_MB override.
const configuredAttachmentLimit = Number(import.meta.env.VITE_MAX_ATTACHMENT_MB || 10);
export const MAX_ATTACHMENT_MB = Number.isFinite(configuredAttachmentLimit) && configuredAttachmentLimit > 0 ? configuredAttachmentLimit : 10;
export const MAX_ATTACHMENT_BYTES = MAX_ATTACHMENT_MB * 1024 * 1024;
export const ALLOWED_ATTACHMENT_TYPES = ".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp,.gif";

export const isImageAttachment = (message) => {
    const mime = String(message?.file_mime || "").toLowerCase().split(";")[0].trim();
    return mime && mime !== "application/octet-stream"
        ? ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(mime)
        : /\.(png|jpe?g|webp|gif)$/i.test(message?.file_name || "");
};

export const formatAttachmentSize = (size) => {
    const bytes = Number(size);
    if (!Number.isFinite(bytes) || bytes <= 0) return "";
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
