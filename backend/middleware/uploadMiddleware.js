const multer = require("multer");
const path = require("path");
const fs = require("fs");
const {
    isObjectStorageEnabled,
    uploadBuffer,
    destroyStoredFile
} = require("../services/objectStorage");

const ensuredDirs = new Set();
const ensureDir = async (dir) => {
    if (ensuredDirs.has(dir)) return;
    await fs.promises.mkdir(dir, { recursive: true });
    ensuredDirs.add(dir);
};

const root = path.join(__dirname, "..", "uploads");
const privateChatRoot = path.join(__dirname, "..", "private_uploads", "chat");
const privateAdminEmployerRoot = path.join(__dirname, "..", "private_uploads", "admin_employer");
const configuredMaxUploadMb = Number(process.env.MAX_UPLOAD_MB || 10);
const MAX_UPLOAD_MB = Number.isFinite(configuredMaxUploadMb) && configuredMaxUploadMb > 0 ? configuredMaxUploadMb : 10;
const limits = { fileSize: MAX_UPLOAD_MB * 1024 * 1024 };
const configuredProfileUploadMb = Number(process.env.MAX_PROFILE_UPLOAD_MB || 5);
const MAX_PROFILE_UPLOAD_MB = Number.isFinite(configuredProfileUploadMb) && configuredProfileUploadMb > 0 ? configuredProfileUploadMb : 5;

const allowedExtensions = /\.(pdf|doc|docx|png|jpe?g|webp|gif)$/i;
const allowedMimes = [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif"
];

const hasAllowedChatSignature = (buffer, mimeType) => {
    if (!buffer || buffer.length < 4) return false;
    if (mimeType === "image/png") return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if (mimeType === "image/jpeg") return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    if (mimeType === "image/gif") return ["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("ascii"));
    if (mimeType === "image/webp") return buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";
    if (mimeType === "application/pdf") return buffer.subarray(0, 5).toString("ascii") === "%PDF-";
    if (["application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"].includes(mimeType)) {
        return buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) || buffer.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]));
    }
    return false;
};

const chatFileFilter = (_req, file, cb) => {
    const extension = path.extname(file.originalname || "").toLowerCase();
    const allowed = new Map([
        [".pdf", "application/pdf"], [".doc", "application/msword"],
        [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
        [".png", "image/png"], [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"],
        [".webp", "image/webp"], [".gif", "image/gif"]
    ]);
    if (!allowed.has(extension) || allowed.get(extension) !== file.mimetype || !allowedMimes.includes(file.mimetype)) {
        const err = new Error("Unsupported file type. Allowed types: PDF, DOC, DOCX, PNG, JPG, WEBP, and GIF.");
        err.status = 415;
        return cb(err);
    }
    return cb(null, true);
};

const verifyChatAttachment = (req, _res, next) => {
    const file = req.file;
    if (!file) return next();
    // The cloud storage engine validates buffered contents before upload. Its
    // path is an opaque storage reference, never a local path to read from disk.
    if (file.signatureVerified) return next();
    const finish = async (err) => {
        if (err) {
            try {
                if (file.storageRef) await destroyStoredFile(file.storageRef);
                else if (file.path) await fs.promises.unlink(file.path);
            } catch { /* Preserve the validation error if cleanup also fails. */ }
            return next(err);
        }
        return next();
    };
    if (file.buffer) {
        if (!hasAllowedChatSignature(file.buffer, file.mimetype)) {
            const err = new Error("The file contents do not match a supported file type.");
            err.status = 415;
            return finish(err);
        }
        return finish();
    }
    fs.promises.readFile(file.path).then((buffer) => {
        if (!hasAllowedChatSignature(buffer, file.mimetype)) {
            const err = new Error("The file contents do not match a supported file type.");
            err.status = 415;
            finish(err);
        } else finish();
    }).catch(finish);
};

const fileFilter = (_req, file, cb) => {
    const isAllowed = allowedMimes.includes(file.mimetype) || allowedExtensions.test(file.originalname);
    if (!isAllowed) {
        return cb(new Error("Invalid file type. Allowed: pdf, doc, docx, png, jpg, webp."));
    }
    return cb(null, true);
};

const profileFileFilter = (req, file, cb) => {
    if (!new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]).has(file.mimetype)) {
        const err = new Error("Profile photos must be PNG, JPG, WebP, or GIF images.");
        err.status = 415;
        return cb(err);
    }
    return fileFilter(req, file, cb);
};

const getTargetForField = (fieldName = "") => {
    if (fieldName === "avatar_image") return { folder: "uploads/images", isPublic: true, prefix: "avatar" };
    if (fieldName === "logo_image") return { folder: "uploads/images", isPublic: true, prefix: "logo" };
    if (fieldName === "resume") return { folder: "private_uploads/resumes", isPublic: false, prefix: "resume" };
    if (fieldName === "transcript") return { folder: "private_uploads/documents", isPublic: false, prefix: "transcript" };
    if (fieldName === "certificate") return { folder: "private_uploads/documents", isPublic: false, prefix: "certificate" };
    if (fieldName === "proof_document") return { folder: "private_uploads/alumni_proof", isPublic: false, prefix: "proof-document" };
    if (fieldName === "business_permit") return { folder: "private_uploads/business_permits", isPublic: false, prefix: "business-permit" };
    if (fieldName === "attachment") return { folder: "private_uploads/chat", isPublic: false, prefix: "attachment" };
    return { folder: "private_uploads/documents", isPublic: false, prefix: fieldName || "file" };
};

const createCloudStorageEngine = () => ({
    _handleFile: (req, file, cb) => {
        const chunks = [];
        file.stream.on("data", (chunk) => chunks.push(chunk));
        file.stream.on("error", (err) => cb(err));
        file.stream.on("end", async () => {
            try {
                const buffer = Buffer.concat(chunks);
                if (file.fieldname === "attachment" && !hasAllowedChatSignature(buffer, file.mimetype)) {
                    const err = new Error("The file contents do not match a supported file type.");
                    err.status = 415;
                    return cb(err);
                }
                const target = getTargetForField(file.fieldname);
                const uploaded = await uploadBuffer({
                    buffer,
                    mimeType: file.mimetype,
                    originalName: file.originalname,
                    folder: target.folder,
                    prefix: target.prefix,
                    isPublic: target.isPublic
                });

                cb(null, {
                    size: buffer.length,
                    filename: path.basename(uploaded.publicId || file.originalname),
                    path: uploaded.storageRef || uploaded.publicUrl,
                    storageRef: uploaded.storageRef || null,
                    publicUrl: uploaded.publicUrl || null,
                    mimetype: file.mimetype,
                    originalname: file.originalname,
                    signatureVerified: file.fieldname === "attachment"
                });
            } catch (err) {
                if (["avatar_image", "logo_image"].includes(file.fieldname)) {
                    const uploadError = new Error("Profile photo storage is unavailable. Please try again later.");
                    uploadError.status = 502;
                    uploadError.publicMessage = uploadError.message;
                    return cb(uploadError);
                }
                cb(err);
            }
        });
    },
    _removeFile: async (_req, file, cb) => {
        try {
            if (file?.storageRef) {
                await destroyStoredFile(file.storageRef);
            }
            cb(null);
        } catch (err) {
            cb(err);
        }
    }
});

const localStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        let dest = path.join(root, "documents");
        if (file.fieldname === "resume") dest = path.join(root, "resumes");
        if (file.fieldname === "proof_document") dest = path.join(root, "documents");
        if (file.fieldname === "avatar_image" || file.fieldname === "logo_image") dest = path.join(root, "images");
        if (file.fieldname === "attachment" && req.originalUrl.includes("/admin-employer/")) {
            dest = privateAdminEmployerRoot;
        } else if (file.fieldname === "attachment") {
            dest = privateChatRoot;
        }

        ensureDir(dest)
            .then(() => cb(null, dest))
            .catch((err) => cb(err));
    },
    filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname) || "";
        const safeExt = allowedExtensions.test(ext) ? ext : "";
        const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
        cb(null, `${file.fieldname}-${unique}${safeExt}`);
    }
});

const storage = isObjectStorageEnabled() ? createCloudStorageEngine() : localStorage;
const upload = multer({ storage, limits, fileFilter });
const profileUpload = multer({ storage, limits: { fileSize: MAX_PROFILE_UPLOAD_MB * 1024 * 1024 }, fileFilter: profileFileFilter }).fields([
    { name: "avatar_image", maxCount: 1 },
    { name: "logo_image", maxCount: 1 }
]);

/**
 * Legacy explicit fields for backward compatibility
 */
const legacyApplicationFields = [
    { name: "resume", maxCount: 1 },
    { name: "transcript", maxCount: 1 },
    { name: "certificate", maxCount: 1 }
];

const MAX_APPLICATION_FILES = Number(process.env.MAX_APPLICATION_FILES || 20);

/**
 * Dynamic requirement file fields:
 * Frontend will send files with field names like:
 *   requirement_resume
 *   requirement_transcript
 *   requirement_valid_govt_id
 *   requirement_tor
 *   requirement_custom_1783662439285_m9drxh_0
 *   ...
 * We accept any file whose fieldname starts with "requirement_" (employer-defined
 * dynamic requirements) as well as the legacy explicit fields (resume, transcript,
 * certificate). Everything else is rejected with LIMIT_UNEXPECTED_FILE semantics.
 *
 * Security controls preserved:
 *  - allowed MIME types
 *  - allowed file extensions
 *  - maximum upload size (limits.fileSize)
 *  - maximum number of uploaded files
 */
const dynamicRequirementFilter = (req, file, cb) => {
    const isLegacy = legacyApplicationFields.some((f) => f.name === file.fieldname);
    const isDynamic = file.fieldname.startsWith("requirement_");

    if (!isLegacy && !isDynamic) {
        // Surface as a Multer-style unexpected field error (handled in errorHandler)
        const err = new Error(`Unexpected file field: ${file.fieldname}`);
        err.code = "LIMIT_UNEXPECTED_FILE";
        err.field = file.fieldname;
        return cb(err);
    }

    // Enforce allowed MIME types / extensions
    const isAllowedType =
        allowedMimes.includes(file.mimetype) || allowedExtensions.test(file.originalname);
    if (!isAllowedType) {
        return cb(new Error("Invalid file type. Allowed: pdf, doc, docx, png, jpg, jpeg."));
    }

    // Enforce maximum number of uploaded files
    req._uploadFileCount = (req._uploadFileCount || 0) + 1;
    if (req._uploadFileCount > MAX_APPLICATION_FILES) {
        const err = new Error("Too many files uploaded.");
        err.code = "LIMIT_FILE_COUNT";
        return cb(err);
    }

    return cb(null, true);
};

/**
 * Use .any() so dynamically generated requirement codes are accepted. The fileFilter
 * is responsible for rejecting unexpected fields (legacy + requirement_* allowed).
 * We cannot use .fields() because the field names are not known ahead of time.
 */
const dynamicRequirementUpload = multer({
    storage,
    limits,
    fileFilter: dynamicRequirementFilter
}).any();

/**
 * Public middleware for backward compatibility.
 * .any() stores files as an array on req.files; the controller (and legacy branch)
 * expects a fieldname-keyed object ({ fieldname: [file, ...] }). We restructure the
 * array into that shape so no controller changes are required.
 * @type {import("express").RequestHandler}
 */
const applicationUpload = (req, res, next) => {
    return dynamicRequirementUpload(req, res, (err) => {
        if (err) {
            return next(err);
        }
        if (Array.isArray(req.files)) {
            const grouped = {};
            for (const file of req.files) {
                if (!grouped[file.fieldname]) grouped[file.fieldname] = [];
                grouped[file.fieldname].push(file);
            }
            req.files = grouped;
        }
        // DEBUG: Log all uploaded files after Multer
        console.log('[DEBUG uploadMiddleware] Object.keys(req.body):', Object.keys(req.body || {}));
        console.log('[DEBUG uploadMiddleware] Object.keys(req.files || {}):', Object.keys(req.files || {}));
        for (const [fieldName, files] of Object.entries(req.files || {})) {
            console.log('[DEBUG uploadMiddleware] Uploaded field:', {
                fieldname: fieldName,
                originalname: files?.[0]?.originalname
            });
        }
        return next();
    });
};

exports.applicationUpload = applicationUpload;

exports.registrationUpload = upload.fields([
    { name: "business_permit", maxCount: 1 },
    { name: "proof_document", maxCount: 1 }
]);

exports.employerRegistrationUpload = upload.fields([
    { name: "business_permit", maxCount: 1 }
]);

exports.alumniRegistrationUpload = upload.single("proof_document");

const chatUpload = multer({ storage, limits, fileFilter: chatFileFilter }).single("attachment");
const runChatUpload = (req, res, next) => chatUpload(req, res, (err) => {
    if (err) return next(err);
    return verifyChatAttachment(req, res, next);
});
exports.chatAttachmentUpload = runChatUpload;
exports.adminEmployerAttachmentUpload = runChatUpload;

exports.optionalProfileUpload = (req, res, next) => {
    if (!String(req.headers["content-type"] || "").includes("multipart/form-data")) {
        return next();
    }
    if (process.env.NODE_ENV === "production" && !isObjectStorageEnabled()) {
        const err = new Error("Profile photo storage is unavailable. Please try again later.");
        err.status = 503;
        err.publicMessage = err.message;
        return next(err);
    }
    return profileUpload(req, res, next);
};
