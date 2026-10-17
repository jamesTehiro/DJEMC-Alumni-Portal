const path = require("path");
const { normalizeStoredPath, resolveLocalStoredFile, setFileResponseHeaders } = require("../utils/storedFiles");
const { isStoredFileReference, sendStoredFile, getStoredFileOriginalName, recoverChatStoredFileReference } = require("./objectStorage");

const missingMessage = "This message attachment could not be found in storage. It may no longer be available.";

// Resolve the record, never a requester-supplied filename. Old deployments saved
// filenames, upload URLs, API URLs and machine-specific absolute paths.
const resolveMessageAttachment = async (storedValue, namespace = "chat") => {
    if (typeof storedValue !== "string" || !storedValue.trim()) return null;
    let value = storedValue.trim();
    if (isStoredFileReference(value)) return { remote: value };
    if (value.startsWith("cld:")) {
        const recovered = await recoverChatStoredFileReference(value);
        return recovered ? { remote: recovered } : null;
    }
    if (/^https?:\/\//i.test(value)) {
        let url;
        try { url = new URL(value); } catch { return null; }
        // Backend upload URLs are legacy local references. Cloudinary URLs keep
        // their remote storage semantics, including authenticated delivery.
        if (url.hostname === "res.cloudinary.com") return { remote: value };
        if (!/^\/(?:uploads|private_uploads|api\/(?:messages\/files|admin-employer\/messages\/files|files))\//.test(url.pathname)) return null;
        value = url.pathname;
    }
    const apiMatch = value.match(/^\/?api\/(?:messages\/files|admin-employer\/messages\/files)\/([^/?]+)(?:\?.*)?$/);
    if (apiMatch) value = apiMatch[1];
    const localValue = value.replace(/%(?![0-9a-f]{2})/gi, "%25");
    const normalized = normalizeStoredPath(localValue);
    if (normalized?.startsWith("/")) {
        // Keep attachment lookup inside message directories, including legacy
        // public upload directories. Symlinks are checked by the shared helper.
        if (!/^\/(?:private_uploads|uploads)\/(?:chat|admin_employer)\//.test(normalized)) return null;
        const local = await resolveLocalStoredFile(localValue);
        return local ? { local } : null;
    }
    // Only bare filenames may use the historical directory fallback.
    let filename;
    try { filename = decodeURIComponent(value); } catch { filename = value; }
    if (!filename || /[\\/\x00-\x1f:]/.test(filename) || [".", ".."].includes(filename)) return null;
    for (const root of ["private_uploads", "uploads"]) {
        const local = await resolveLocalStoredFile(`/${root}/${namespace}/${encodeURIComponent(filename)}`);
        if (local) return { local };
    }
    return null;
};

const sendMessageAttachment = async ({ storedValue, name, mime, namespace, download = false }, res) => {
    const source = await resolveMessageAttachment(storedValue, namespace);
    if (!source) return res.status(404).json({ msg: missingMessage });
    const filename = name || getStoredFileOriginalName(storedValue) || path.basename(source.local || "attachment");
    const canPreview = ["application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif"].includes(mime);
    setFileResponseHeaders(res, filename, download || !canPreview);
    res.setHeader("Content-Type", mime || "application/octet-stream");
    if (source.local) return res.sendFile(source.local);
    try {
        return await sendStoredFile(source.remote, res, null, mime);
    } catch (error) {
        res.removeHeader?.("Content-Disposition");
        res.removeHeader?.("Content-Type");
        if (error.status === 404) {
            return res.status(404).json({ msg: missingMessage });
        }
        const failure = new Error("Attachment storage is temporarily unavailable. Please try again later.");
        failure.status = 502;
        failure.publicMessage = failure.message;
        throw failure;
    }
};

module.exports = { resolveMessageAttachment, sendMessageAttachment };
