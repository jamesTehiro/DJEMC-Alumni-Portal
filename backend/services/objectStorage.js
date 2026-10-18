const crypto = require("crypto");
const path = require("path");

const provider = String(process.env.OBJECT_STORAGE_PROVIDER || "cloudinary").trim().toLowerCase();
const cloudName = String(process.env.CLOUDINARY_CLOUD_NAME || "").trim();
const apiKey = String(process.env.CLOUDINARY_API_KEY || "").trim();
const apiSecret = String(process.env.CLOUDINARY_API_SECRET || "").trim();

const REF_PREFIX = "cld:";

const isObjectStorageEnabled = () => provider === "cloudinary" && !!cloudName && !!apiKey && !!apiSecret;

const ensureObjectStorageConfigured = () => {
    if (isObjectStorageEnabled()) return;
    const err = new Error("Shared object storage is not configured.");
    err.status = 500;
    throw err;
};

const sanitizeBaseName = (value = "", fallback = "file") =>
    String(value || fallback)
        .replace(/\.[^.]+$/, "")
        .replace(/[^a-zA-Z0-9_-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "") || fallback;

const buildPublicId = ({ folder, prefix, originalName }) => {
    const extension = path.extname(String(originalName || "")).toLowerCase();
    const safePrefix = sanitizeBaseName(prefix, "file");
    const safeFolder = String(folder || "")
        .replace(/^\/+|\/+$/g, "")
        .replace(/[^a-zA-Z0-9/_-]+/g, "");
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    const fileName = `${safePrefix}-${uniqueSuffix}${extension}`;
    return safeFolder ? `${safeFolder}/${fileName}` : fileName;
};

const signCloudinaryParams = (params) => {
    const payload = Object.entries(params)
        .filter(([, value]) => value !== undefined && value !== null && value !== "")
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}=${value}`)
        .join("&");

    return crypto.createHash("sha1").update(`${payload}${apiSecret}`).digest("hex");
};

const encodeStoredFileReference = (payload) =>
    `${REF_PREFIX}${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`;

// Recover complete Cloudinary fields from references truncated by older
// VARCHAR(500) ApplicationDocuments.file_path columns.
const recoverTruncatedCloudinaryReference = (value) => {
    try {
        const decoded = Buffer.from(value.slice(REF_PREFIX.length), "base64url").toString("utf8");
        const readString = (key) => {
            const marker = `${JSON.stringify(key)}:`;
            const markerIndex = decoded.indexOf(marker);
            if (markerIndex < 0) return null;
            let index = markerIndex + marker.length;
            if (decoded[index] !== '"') return null;
            const start = index;
            index += 1;
            for (; index < decoded.length; index += 1) {
                if (decoded[index] === "\\") {
                    index += 1;
                    continue;
                }
                if (decoded[index] === '"') return JSON.parse(decoded.slice(start, index + 1));
            }
            return null;
        };

        const provider = readString("provider");
        const resourceType = readString("resourceType");
        const type = readString("type");
        const publicId = readString("publicId");
        const url = readString("url");
        if (provider !== "cloudinary" || !["image", "raw", "video"].includes(resourceType) || !["upload", "authenticated"].includes(type)) return null;
        if (!publicId || !/^[A-Za-z0-9._/-]+$/.test(publicId) || publicId.split("/").some((part) => !part || part === "." || part === "..")) return null;

        const parsedUrl = new URL(url);
        const urlParts = parsedUrl.pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
        if (parsedUrl.protocol !== "https:" || parsedUrl.hostname !== "res.cloudinary.com" || parsedUrl.port || parsedUrl.username || parsedUrl.password) return null;
        if (urlParts.length < 5 || urlParts[1] !== resourceType || urlParts[2] !== type) return null;
        const assetPath = urlParts.slice(4).join("/");
        const matchesPublicId = assetPath === publicId ||
            (assetPath.startsWith(`${publicId}.`) && /^\.(jpg|jpeg|png|gif|webp|avif|bmp|pdf|doc|docx)$/i.test(assetPath.slice(publicId.length)));
        if (!matchesPublicId) return null;

        return { provider, resourceType, type, publicId, url };
    } catch {
        return null;
    }
};

const parseStoredFileReference = (value) => {
    if (!value || typeof value !== "string" || !value.startsWith(REF_PREFIX)) return null;

    try {
        return JSON.parse(Buffer.from(value.slice(REF_PREFIX.length), "base64url").toString("utf8"));
    } catch {
        return recoverTruncatedCloudinaryReference(value);
    }
};

const isStoredFileReference = (value) => !!parseStoredFileReference(value);

const uploadBuffer = async ({ buffer, mimeType, originalName, folder, prefix, isPublic, deliveryType = "upload" }) => {
    ensureObjectStorageConfigured();

    if (typeof fetch !== "function" || typeof FormData !== "function" || typeof Blob !== "function") {
        const err = new Error("Node runtime does not support fetch/FormData uploads.");
        err.status = 500;
        throw err;
    }

    const publicId = buildPublicId({ folder, prefix, originalName });
    const timestamp = Math.floor(Date.now() / 1000);
    const resourceType = String(mimeType || "").startsWith("image/") ? "image" : "raw";
    const type = deliveryType === "authenticated" ? "authenticated" : "upload";

    const signature = signCloudinaryParams({
        public_id: publicId,
        timestamp,
        type
    });

    const form = new FormData();
    form.append("file", new Blob([buffer], { type: mimeType || "application/octet-stream" }), originalName || path.basename(publicId));
    form.append("api_key", apiKey);
    form.append("timestamp", String(timestamp));
    form.append("public_id", publicId);
    form.append("type", type);
    form.append("signature", signature);

    const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`, {
        method: "POST",
        body: form
    });

    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.secure_url || !data?.public_id) {
        const err = new Error(data?.error?.message || "Object storage upload failed.");
        err.status = 502;
        throw err;
    }

    const storedRef = encodeStoredFileReference({
        provider: "cloudinary",
        resourceType: data.resource_type || resourceType,
        type: data.type || type,
        publicId: data.public_id,
        url: data.secure_url,
        originalName: originalName || path.basename(publicId)
    });

    return {
        publicUrl: data.secure_url,
        storageRef: isPublic ? data.secure_url : storedRef,
        remoteUrl: data.secure_url,
        publicId: data.public_id,
        resourceType: data.resource_type || resourceType,
        type: data.type || type
    };
};

const uploadDataUrl = async ({ dataUrl, folder, prefix }) => {
    if (!dataUrl || typeof dataUrl !== "string") return null;
    const matches = dataUrl.match(/^data:([a-zA-Z0-9/+.-]+);base64,(.+)$/);
    if (!matches) return null;

    const mimeType = matches[1];
    const buffer = Buffer.from(matches[2], "base64");
    const extension = mimeType.split("/")[1] || "png";
    const originalName = `${sanitizeBaseName(prefix, "image")}.${extension}`;

    const result = await uploadBuffer({
        buffer,
        mimeType,
        originalName,
        folder,
        prefix,
        isPublic: true
    });

    return result.publicUrl;
};

const destroyStoredFile = async (storedValue) => {
    const parsed = parseStoredFileReference(storedValue);
    if (!parsed) return false;

    ensureObjectStorageConfigured();

    const timestamp = Math.floor(Date.now() / 1000);
    const signature = signCloudinaryParams({
        public_id: parsed.publicId,
        timestamp,
        type: parsed.type || "upload",
        invalidate: true
    });

    const form = new URLSearchParams();
    form.set("api_key", apiKey);
    form.set("timestamp", String(timestamp));
    form.set("public_id", parsed.publicId);
    form.set("type", parsed.type || "upload");
    form.set("invalidate", "true");
    form.set("signature", signature);

    const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/${parsed.resourceType || "raw"}/destroy`, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded"
        },
        body: form.toString()
    });

    return response.ok;
};

const authenticatedDeliveryUrl = (parsed) => {
    if (parsed?.type !== "authenticated" || !apiSecret || !cloudName) return null;
    try {
        const source = new URL(parsed.url);
        if (source.protocol !== "https:" || source.hostname !== "res.cloudinary.com" || source.port || source.username || source.password) return null;
        const segments = source.pathname.split("/").filter(Boolean);
        const typeIndex = segments.findIndex((segment, index) => index > 1 && segment === "authenticated");
        if (typeIndex !== 2 || segments[0] !== cloudName || segments[1] !== parsed.resourceType || !segments[typeIndex + 1]) return null;
        const resourcePath = segments.slice(typeIndex + 1).join("/");
        const signature = crypto.createHash("sha1").update(`${resourcePath}${apiSecret}`).digest("base64url").slice(0, 8);
        return `https://res.cloudinary.com/${cloudName}/${parsed.resourceType}/authenticated/s--${signature}--/${resourcePath}`;
    } catch {
        return null;
    }
};

const getDownloadSourceUrl = (storedValue) => {
    const parsed = parseStoredFileReference(storedValue);
    if (parsed?.type === "authenticated") return authenticatedDeliveryUrl(parsed);
    if (parsed?.url) return parsed.url;
    if (/^https?:\/\//i.test(String(storedValue || ""))) return storedValue;
    return null;
};

// Cloudinary's authenticated raw files (notably PDFs) are more reliably
// retrieved through its signed private-download API than through a CDN
// delivery URL. Keep this URL server-side and short-lived; it is never
// returned in an API response or written to logs.
const privateDownloadSourceUrl = (storedValue) => {
    const parsed = parseStoredFileReference(storedValue);
    if (!parsed || parsed.provider !== "cloudinary" || !["image", "raw"].includes(parsed.resourceType) || !["authenticated", "private"].includes(parsed.type)) return null;
    if (!apiKey || !apiSecret || !cloudName || !parsed.publicId) return null;
    try {
        const source = new URL(parsed.url);
        if (source.protocol !== "https:" || source.hostname !== "res.cloudinary.com" || source.port || source.username || source.password) return null;
        const segments = source.pathname.split("/").filter(Boolean).map(segment => decodeURIComponent(segment));
        if (segments[0] !== cloudName || segments[1] !== parsed.resourceType || segments[2] !== parsed.type) return null;
        if (!/^[A-Za-z0-9._/-]+$/.test(parsed.publicId) || parsed.publicId.split("/").some(part => !part || part === "." || part === "..")) return null;
        if (segments.length < 5 || !/^v\d+$/.test(segments[3])) return null;
        const sourceAsset = segments.slice(4).join("/");
        const referenceMatchesSource = sourceAsset === parsed.publicId ||
            (parsed.resourceType === "image" && sourceAsset.startsWith(`${parsed.publicId}.`) && /^\.(png|jpe?g)$/i.test(sourceAsset.slice(parsed.publicId.length)));
        if (!referenceMatchesSource) return null;

        const urlFormat = path.extname(decodeURIComponent(segments.at(-1) || "")).slice(1).toLowerCase();
        const publicIdFormat = parsed.resourceType === "raw" ? path.extname(parsed.publicId).slice(1).toLowerCase() : "";
        const format = String(parsed.format || publicIdFormat || urlFormat).toLowerCase();
        if (!/^(pdf|png|jpe?g)$/.test(format)) return null;
        if (parsed.resourceType === "raw" && format !== "pdf") return null;
        if (parsed.resourceType === "image" && format === "pdf") return null;

        const timestamp = Math.floor(Date.now() / 1000);
        const params = {
            attachment: false,
            expires_at: timestamp + 300,
            format,
            public_id: parsed.publicId,
            timestamp,
            type: parsed.type
        };
        const payload = Object.entries(params)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, value]) => `${key}=${value}`.replace(/&/g, "%26"))
            .join("&");
        const signature = crypto.createHash("sha1").update(`${payload}${apiSecret}`).digest("hex");
        const query = new URLSearchParams({ ...params, signature, api_key: apiKey });
        return `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/${parsed.resourceType}/download?${query.toString()}`;
    } catch {
        return null;
    }
};

const getStoredFileOriginalName = (storedValue) => {
    const parsed = parseStoredFileReference(storedValue);
    return parsed?.originalName || null;
};

// VARCHAR(255) chat rows can end before the delivery URL. Recover only a
// complete asset identity, then ask the configured provider for the real URL.
// Never guess a missing public ID, recreate a file, or rewrite the stored row.
const recoverStoredFileReference = async (value, folders) => {
    if (typeof value !== "string" || !value.startsWith(REF_PREFIX) || !isObjectStorageEnabled()) return null;
    if (parseStoredFileReference(value)) return value;
    const decoded = Buffer.from(value.slice(REF_PREFIX.length), "base64url").toString("utf8");
    const field = key => {
        const match = decoded.match(new RegExp(`"${key}":("(?:[^"\\\\]|\\\\.)*")`));
        try { return match ? JSON.parse(match[1]) : null; } catch { return null; }
    };
    const resourceType = field("resourceType"), type = field("type"), publicId = field("publicId");
    if (field("provider") !== "cloudinary" || !["image", "raw"].includes(resourceType) || !["upload", "authenticated"].includes(type)) return null;
    if (!publicId || !/^[A-Za-z0-9._/-]+$/.test(publicId) || !folders.some(folder => publicId.startsWith(`${folder}/`)) || publicId.split("/").some(part => !part || part === "." || part === "..")) return null;
    let response;
    try {
        response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/resources/${resourceType}/${type}/${encodeURIComponent(publicId)}`, {
            headers: { Authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString("base64")}` }
        });
    } catch {
        const error = new Error("Attachment storage is temporarily unavailable. Please try again later.");
        error.status = 502;
        error.publicMessage = error.message;
        throw error;
    }
    if (response.status === 404) return null;
    if (!response.ok) {
        const error = new Error("Attachment storage is temporarily unavailable. Please try again later.");
        error.status = 502;
        error.publicMessage = error.message;
        throw error;
    }
    const asset = await response.json();
    if (asset.public_id !== publicId || asset.resource_type !== resourceType || asset.type !== type) return null;
    let url;
    try { url = new URL(asset.secure_url); } catch { return null; }
    if (url.protocol !== "https:" || url.hostname !== "res.cloudinary.com" || !url.pathname.startsWith(`/${cloudName}/${resourceType}/${type}/`)) return null;
    return encodeStoredFileReference({ provider: "cloudinary", resourceType, type, publicId, url: asset.secure_url });
};

const recoverChatStoredFileReference = value => recoverStoredFileReference(value, ["private_uploads/chat", "private_uploads/admin_employer"]);
const recoverPermitStoredFileReference = value => recoverStoredFileReference(value, ["private_uploads/business_permits", "uploads/documents"]);

const sendStoredFile = async (storedValue, res, downloadName = null, contentTypeOverride = null, usePrivateDownloadApi = false) => {
    const sourceUrl = usePrivateDownloadApi ? privateDownloadSourceUrl(storedValue) : getDownloadSourceUrl(storedValue);
    if (!sourceUrl) {
        const err = new Error("Stored file URL could not be resolved.");
        err.status = 404;
        throw err;
    }

    const response = await fetch(sourceUrl);
    if (!response.ok) {
        const err = new Error("Stored file could not be downloaded.");
        err.status = response.status || 502;
        throw err;
    }

    const contentType = contentTypeOverride || response.headers.get("content-type") || "application/octet-stream";
    const buffer = Buffer.from(await response.arrayBuffer());

    res.setHeader("Content-Type", contentType);
    if (downloadName) {
        const safeName = String(downloadName).replace(/[\r\n"]/g, "_");
        res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
    }
    return res.send(buffer);
};

module.exports = {
    isObjectStorageEnabled,
    uploadBuffer,
    uploadDataUrl,
    destroyStoredFile,
    sendStoredFile,
    isStoredFileReference,
    parseStoredFileReference,
    privateDownloadSourceUrl,
    getStoredFileOriginalName,
    recoverChatStoredFileReference,
    recoverPermitStoredFileReference
};
