const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
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
const businessPermitRoot = path.join(root, "business-permits");
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

const isApplicationField = (fieldName = "") =>
    ["resume", "transcript", "certificate"].includes(fieldName) || fieldName.startsWith("requirement_");

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
    if (file.fieldname === "proof_document") return chatFileFilter(_req, file, cb);
    if (file.fieldname === "business_permit") {
        // Busboy's legacy multipart filename decoding is Latin-1. Recover UTF-8
        // names only when the byte round trip is lossless.
        const decodedName = Buffer.from(file.originalname, "latin1").toString("utf8");
        if (!decodedName.includes("\uFFFD") && Buffer.from(decodedName, "utf8").toString("latin1") === file.originalname) file.originalname = decodedName;
        if (!["application/pdf", "image/png", "image/jpeg"].includes(file.mimetype)) {
            const error = new Error("Business permits must be PNG, JPG, JPEG, or PDF files."); error.status = 415; return cb(error);
        }
        return chatFileFilter(_req, file, cb);
    }
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
    if (fieldName === "resume") return { folder: "private_uploads/resumes", isPublic: false, prefix: "resume", deliveryType: "authenticated" };
    if (fieldName === "transcript") return { folder: "private_uploads/documents", isPublic: false, prefix: "transcript", deliveryType: "authenticated" };
    if (fieldName === "certificate") return { folder: "private_uploads/documents", isPublic: false, prefix: "certificate", deliveryType: "authenticated" };
    if (fieldName === "proof_document") return { folder: "private_uploads/alumni_proof", isPublic: false, prefix: "proof-document", deliveryType: "authenticated" };
    if (fieldName === "business_permit") return { folder: "private_uploads/business_permits", isPublic: false, prefix: "business-permit", deliveryType: "authenticated" };
    if (fieldName === "attachment") return { folder: "private_uploads/chat", isPublic: false, prefix: "attachment", deliveryType: "authenticated" };
    return { folder: "private_uploads/documents", isPublic: false, prefix: fieldName || "file", deliveryType: "authenticated" };
};

const createCloudStorageEngine = () => ({
    _handleFile: (req, file, cb) => {
        const chunks = [];
        file.stream.on("data", (chunk) => chunks.push(chunk));
        file.stream.on("error", (err) => cb(err));
        file.stream.on("end", async () => {
            try {
                const buffer = Buffer.concat(chunks);
                if (file.stream.truncated) return cb(null, {});
                if ((isApplicationField(file.fieldname) || ["attachment", "business_permit", "proof_document"].includes(file.fieldname)) && !hasAllowedChatSignature(buffer, file.mimetype)) {
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
                    isPublic: target.isPublic,
                    deliveryType: target.deliveryType
                });

                cb(null, {
                    size: buffer.length,
                    filename: path.basename(uploaded.publicId || file.originalname),
                    path: uploaded.storageRef || uploaded.publicUrl,
                    storageRef: uploaded.storageRef || null,
                    publicUrl: uploaded.publicUrl || null,
                    mimetype: file.mimetype,
                    originalname: file.originalname,
                    signatureVerified: ["attachment", "proof_document"].includes(file.fieldname)
                });
            } catch (err) {
                if (file.fieldname === "attachment") {
                    console.error("[message-attachment-upload]", err.storageDiagnostic || { provider: "cloudinary", failure: "upload", upstreamStatus: null });
                    const uploadError = new Error("Message attachment storage is unavailable. The file was not saved. Please try again later.");
                    uploadError.status = 502;
                    uploadError.publicMessage = uploadError.message;
                    return cb(uploadError);
                }
                if (file.fieldname === "business_permit" && err.status !== 415) {
                    const uploadError = new Error("Business permit storage is unavailable. The document was not saved. Please try again.");
                    uploadError.status = 502;
                    uploadError.publicMessage = uploadError.message;
                    return cb(uploadError);
                }
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

const localDiskStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        if (file.fieldname === "attachment" && (process.env.NODE_ENV === "production" || String(process.env.RENDER).toLowerCase() === "true")) {
            const err = new Error("Persistent messaging attachment storage is unavailable. Please try again later.");
            err.status = 503;
            err.publicMessage = err.message;
            return cb(err);
        }
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

const localStorage = {
    _handleFile(req, file, cb) {
        localDiskStorage._handleFile(req, file, async (error, info) => {
            if (error || !isApplicationField(file.fieldname) || file.stream.truncated) return cb(error, info);
            try {
                if (!hasAllowedChatSignature(await fs.promises.readFile(info.path), file.mimetype)) {
                    throw Object.assign(new Error("The file contents do not match a supported file type."), { status: 415 });
                }
                return cb(null, info);
            } catch (validationError) {
                await fs.promises.unlink(info.path).catch(() => {});
                return cb(validationError);
            }
        });
    },
    _removeFile: (req, file, cb) => localDiskStorage._removeFile(req, file, cb)
};

const storage = isObjectStorageEnabled() ? createCloudStorageEngine() : localStorage;
const businessPermitStorage = multer.diskStorage({
    destination: (_req, _file, cb) => ensureDir(businessPermitRoot)
        .then(() => cb(null, businessPermitRoot))
        .catch(() => cb(Object.assign(new Error("Business permit storage is unavailable. The document was not saved."), { status: 503, publicMessage: "Business permit storage is unavailable. The document was not saved." }))),
    filename: (_req, file, cb) => {
        const extension = path.extname(file.originalname || "").toLowerCase();
        const allowed = new Map([["application/pdf", [".pdf"]], ["image/png", [".png"]], ["image/jpeg", [".jpg", ".jpeg"]]]);
        if (!allowed.get(file.mimetype)?.includes(extension)) {
            return cb(Object.assign(new Error("Business permits must be PDF, PNG, JPG, or JPEG files."), { status: 415 }));
        }
        cb(null, `business-permit-${crypto.randomUUID()}${extension}`);
    }
});
const permitAwareStorage = {
    _handleFile: (req, file, cb) => {
        const isPermit = file.fieldname === "business_permit";
        const engine = isPermit ? businessPermitStorage : storage;
        engine._handleFile(req, file, (error, info) => {
            if (error) {
                if (isPermit) return cb(Object.assign(new Error("Business permit storage is unavailable. The document was not saved."), { status: 503, publicMessage: "Business permit storage is unavailable. The document was not saved." }));
                return cb(error);
            }
            if (isPermit) {
                info.storageRef = `/uploads/business-permits/${info.filename}`;
                info.permitDiskFile = true;
            }
            cb(null, info);
        });
    },
    _removeFile: (req, file, cb) => (file.permitDiskFile ? businessPermitStorage : storage)._removeFile(req, file, cb)
};
const upload = multer({ storage: permitAwareStorage, limits, fileFilter });
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

    // Require the declared type to match the extension. Both storage engines
    // also check the file signature before accepting an applicant document.
    let typeError;
    chatFileFilter(req, file, error => { typeError = error; });
    if (typeError) return cb(typeError);

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
        return next();
    });
};

exports.applicationUpload = applicationUpload;

const withBusinessPermitValidation = parser => (req, res, next) => parser(req, res, async error => {
    if (error) {
        if (error.code === "LIMIT_UNEXPECTED_FILE" && error.field === "business_permit") return next(Object.assign(new Error("You can upload up to five business permit files."), { status: 400 }));
        if (error.code === "LIMIT_UNEXPECTED_FILE" && error.field === "proof_document") return next(Object.assign(new Error("You can upload up to six proof of graduation files."), { status: 400 }));
        return next(error);
    }
    const files = req.files?.business_permit || [];
    const proofs = req.files?.proof_document || [];
    // A rejected registration must not leave a newly uploaded private proof
    // behind. This listener only touches files parsed by this request.
    res.once("finish", () => {
        if (res.statusCode >= 400) for (const file of proofs) storage._removeFile(req, file, () => {});
    });
    try {
        for (const file of proofs) {
            if (!file.signatureVerified && !hasAllowedChatSignature(await fs.promises.readFile(file.path), file.mimetype)) {
                throw Object.assign(new Error("The proof contents do not match the selected file type."), { status: 415 });
            }
        }
        for (const file of files) {
            let buffer;
            try { buffer = await fs.promises.readFile(file.path); }
            catch { throw Object.assign(new Error("Business permit storage is unavailable. The document could not be verified."), { status: 503, publicMessage: "Business permit storage is unavailable. The document could not be verified." }); }
            if (!hasAllowedChatSignature(buffer, file.mimetype)) {
                const error = new Error("The business permit contents do not match the selected file type."); error.status = 415; throw error;
            }
        }
        res.once("finish", () => {
            if (res.statusCode >= 400) {
                for (const file of files) if (file.permitDiskFile) fs.promises.unlink(file.path).catch(() => {});
            }
        });
        next();
    } catch (error) {
        await Promise.allSettled(proofs.map(file => new Promise(resolve => storage._removeFile(req, file, resolve))));
        await Promise.allSettled(files.map(file => new Promise(resolve => permitAwareStorage._removeFile(req, file, resolve))));
        next(error);
    }
});

exports.registrationUpload = withBusinessPermitValidation(upload.fields([
    { name: "business_permit", maxCount: 5 },
    { name: "proof_document", maxCount: 6 }
 ]));

exports.employerRegistrationUpload = withBusinessPermitValidation(upload.fields([
    { name: "business_permit", maxCount: 5 }
 ]));

exports.alumniRegistrationUpload = withBusinessPermitValidation(upload.fields([
    { name: "proof_document", maxCount: 6 }
]));

const chatUpload = multer({ storage, limits, fileFilter: chatFileFilter }).single("attachment");
const runChatUpload = (req, res, next) => chatUpload(req, res, (err) => {
    if (err) return next(err);
    return verifyChatAttachment(req, res, next);
});
const requirePersistentMessagingStorage = (req, res, next) => {
    // Render's writable filesystem is ephemeral unless a disk is explicitly
    // mounted. Require shared storage there so newly sent chat files survive a
    // restart or redeploy instead of silently creating another fragile path.
    // The disk engine rejects attachment writes in production. Parse first so
    // text-only messages remain available during a storage outage.
    return runChatUpload(req, res, next);
};
exports.chatAttachmentUpload = requirePersistentMessagingStorage;
exports.adminEmployerAttachmentUpload = requirePersistentMessagingStorage;

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
