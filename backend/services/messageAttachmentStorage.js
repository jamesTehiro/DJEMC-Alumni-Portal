const path = require("path");
const { normalizeStoredPath, resolveLocalStoredFile, setFileResponseHeaders } = require("../utils/storedFiles");
const { isStoredFileReference, sendStoredFile, getStoredFileOriginalName, recoverChatStoredFileReference, parseStoredFileReference } = require("./objectStorage");

const missingMessage = "This message attachment could not be found in storage. It may no longer be available.";

// Resolve the record, never a requester-supplied filename. Old deployments saved
// filenames, upload URLs, API URLs and machine-specific absolute paths.
const resolveMessageAttachment = async (storedValue, namespace = "chat", strict = false) => {
    const invalid = () => {
        if (strict) throw Object.assign(new Error("Invalid message attachment reference."), { status: 400 });
        return null;
    };
    if (typeof storedValue !== "string" || !storedValue.trim()) return invalid();
    let value = storedValue.trim();
    if (isStoredFileReference(value)) return { remote: value };
    if (value.startsWith("cld:")) {
        const recovered = await recoverChatStoredFileReference(value, { reportMissing: strict });
        return recovered ? { remote: recovered } : invalid();
    }
    if (/^https?:\/\//i.test(value)) {
        let url;
        try { url = new URL(value); } catch { return invalid(); }
        // Backend upload URLs are legacy local references. Cloudinary URLs keep
        // their remote storage semantics, including authenticated delivery.
        if (url.hostname === "res.cloudinary.com") return { remote: value };
        if (!/^\/(?:uploads|private_uploads|api\/(?:messages\/files|admin-employer\/messages\/files|files))\//.test(url.pathname)) return invalid();
        value = url.pathname;
    }
    const apiMatch = value.match(/^\/?api\/(?:messages\/files|admin-employer\/messages\/files)\/([^/?]+)(?:\?.*)?$/);
    if (apiMatch) value = apiMatch[1];
    const localValue = value.replace(/%(?![0-9a-f]{2})/gi, "%25");
    const normalized = normalizeStoredPath(localValue);
    if (normalized?.startsWith("/")) {
        // Keep attachment lookup inside message directories, including legacy
        // public upload directories. Symlinks are checked by the shared helper.
        if (!/^\/(?:private_uploads|uploads)\/(?:chat|admin_employer)\//.test(normalized)) return invalid();
        const local = await resolveLocalStoredFile(localValue);
        return local ? { local } : null;
    }
    // Only bare filenames may use the historical directory fallback.
    let filename;
    try { filename = decodeURIComponent(value); } catch { filename = value; }
    if (!filename || /[\\/\x00-\x1f:]/.test(filename) || [".", ".."].includes(filename)) return invalid();
    for (const root of ["private_uploads", "uploads"]) {
        const local = await resolveLocalStoredFile(`/${root}/${namespace}/${encodeURIComponent(filename)}`);
        if (local) return { local };
    }
    return null;
};

const sendMessageAttachment = async ({ storedValue, name, mime, namespace, download = false }, res) => {
    setFileResponseHeaders(res);
    if (!storedValue) return res.status(404).json({ msg: missingMessage });
    let source;
    try { source = await resolveMessageAttachment(storedValue, namespace, true); }
    catch (error) { return attachmentFailure(error, res); }
    if (!source) return res.status(404).json({ msg: missingMessage });
    const filename = name || getStoredFileOriginalName(storedValue) || path.basename(source.local || parseStoredFileReference(storedValue)?.publicId || "attachment");
    const legacyMimes = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
    const contentType = mime || legacyMimes[path.extname(filename).toLowerCase()] || null;
    const canPreview = ["application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif"].includes(contentType);
    setFileResponseHeaders(res, filename, download || !canPreview);
    res.setHeader("Content-Type", contentType || "application/octet-stream");
    if (source.local) return new Promise((resolve, reject) => {
        res.sendFile(source.local, { etag: false, lastModified: false, cacheControl: false }, error => {
            if (!error) return resolve();
            // Do not expose filesystem paths from sendFile's asynchronous errors.
            try { resolve(attachmentFailure({ status: error.status === 404 || error.code === 'ENOENT' ? 404 : 502 }, res)); }
            catch (failure) { reject(failure); }
        });
    });
    try {
        return await sendStoredFile(source.remote, res, null, contentType);
    } catch (error) {
        return attachmentFailure(error, res);
    }
};

const attachmentFailure = (error, res) => {
    res.removeHeader?.("Content-Disposition");
    res.removeHeader?.("Content-Type");
    res.setHeader("Cache-Control", "private, no-store");
    if (error.storageDiagnostic) console.error("[message-attachment-storage]", error.storageDiagnostic);
    if (error.status === 404) return res.status(404).json({ msg: missingMessage });
    if (error.status === 400 && !error.storageDiagnostic?.upstreamStatus) throw error;
    throw Object.assign(new Error("Attachment storage is temporarily unavailable. Please try again later."), {
        status: error.status === 503 ? 503 : 502,
        publicMessage: "Attachment storage is temporarily unavailable. Please try again later."
    });
};

module.exports = { resolveMessageAttachment, sendMessageAttachment };
