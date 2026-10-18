// Read-only metadata/HEAD diagnostics. Never print references, tokens, URLs,
// filenames, credentials, provider messages, or document contents.
const crypto = require("node:crypto");
const path = require("node:path");
const db = require("../models");
const { parseStoredFileReference, privateDownloadSourceUrl, sendStoredFile } = require("../services/objectStorage");

const fingerprint = value => crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);
const classify = value => {
    const message = String(value || "").toLowerCase();
    if (message.includes("signature")) return "signature_rejected";
    if (message.includes("transformation")) return "invalid_transformation";
    if (message.includes("not found")) return "asset_missing";
    if (message.includes("deny") || message.includes("denied") || message.includes("blocked")) return "delivery_denied";
    return message ? "provider_error" : null;
};
const head = async url => {
    try {
        const response = await fetch(url, { method: "HEAD", redirect: "error", signal: AbortSignal.timeout(20000) });
        return { status: response.status, mime: response.headers.get("content-type"), providerCode: classify(response.headers.get("x-cld-error")) };
    } catch { return { failure: "network_or_redirect" }; }
};
const probeHelper = async reference => {
    const originalFetch = global.fetch;
    let status;
    try {
        global.fetch = async (url, options) => {
            const response = await originalFetch(url, { ...options, method: "HEAD", signal: AbortSignal.timeout(20000) });
            status = response.status;
            return response;
        };
        await sendStoredFile(reference, { setHeader() {}, send() {} });
        return { status };
    } catch (error) { return { status: status || null, failure: error.storageDiagnostic?.failure || "network" }; }
    finally { global.fetch = originalFetch; }
};

(async () => {
    try {
        if (process.argv.includes("--deployment-check")) {
            // Anonymous request with a fixed invalid placeholder. No real
            // document token or Authorization header is sent or printed.
            const response = await fetch("https://djemc-alumni-backend.onrender.com/api/files/secure/diagnostic-invalid", {
                signal: AbortSignal.timeout(60000), cache: "no-store"
            });
            const checks = {
                unauthorized: response.status === 401,
                privateNoStore: response.headers.get("cache-control") === "private, no-store",
                noEtag: !response.headers.has("etag"),
                variesByAuthorization: /(?:^|,)\s*authorization\s*(?:,|$)/i.test(response.headers.get("vary") || "")
            };
            console.log(JSON.stringify({ deploymentProbe: "anonymous_secure_file", status: response.status, checks, matchesLocalRoutePolicy: Object.values(checks).every(Boolean) }));
            if (!Object.values(checks).every(Boolean)) process.exitCode = 1;
            return;
        }
        console.log(JSON.stringify({ database: /^(localhost|127\.0\.0\.1|::1)$/.test(process.env.DB_HOST) ? "local" : "remote", storageConfigured: !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) }));
        const userIdIndex = process.argv.indexOf("--user-id");
        const userId = userIdIndex >= 0 ? process.argv[userIdIndex + 1] : null;
        if (userIdIndex >= 0 && !/^[1-9]\d*$/.test(userId || "")) throw new Error("Invalid diagnostic user ID.");
        const where = { proof_document_path: { [db.Sequelize.Op.ne]: null }, ...(userId ? { user_id: userId } : {}) };
        const rows = await db.AlumniProfile.findAll({ attributes: ["proof_document_path", "createdAt"], where, order: [["createdAt", "ASC"]], raw: true });
        const columns = await db.sequelize.getQueryInterface().describeTable(db.AlumniProfile.getTableName());
        console.log(JSON.stringify({ proofReferenceColumnType: columns.proof_document_path?.type || null, targetedRecord: !!userId }));
        const candidates = [rows[0], rows.at(-1)];
        if (process.argv.includes("--provider-sample")) {
            for (const resourceType of ["image", "raw"]) {
                const url = new URL(`https://api.cloudinary.com/v1_1/${encodeURIComponent(process.env.CLOUDINARY_CLOUD_NAME)}/resources/${resourceType}/authenticated`);
                url.search = new URLSearchParams({ prefix: "private_uploads/alumni_proof/", max_results: "1", direction: "desc" });
                const response = await fetch(url, { headers: { Authorization: `Basic ${Buffer.from(`${process.env.CLOUDINARY_API_KEY}:${process.env.CLOUDINARY_API_SECRET}`).toString("base64")}` }, signal: AbortSignal.timeout(20000) });
                if (!response.ok) { console.log(JSON.stringify({ providerLookupStatus: response.status, resourceType })); continue; }
                const data = await response.json();
                console.log(JSON.stringify({ providerSampleCount: data.resources?.length || 0, resourceType }));
                for (const asset of data.resources || []) candidates.push({ proof_document_path: `cld:${Buffer.from(JSON.stringify({ provider: "cloudinary", resourceType: asset.resource_type, type: asset.type, publicId: asset.public_id, url: asset.secure_url })).toString("base64url")}` });
            }
        }
        for (const type of ["upload", "authenticated"]) {
            const row = rows.find(row => parseStoredFileReference(row.proof_document_path)?.type === type);
            if (row) candidates.push(row);
        }
        const seen = new Set();
        console.log(JSON.stringify({ totalProofs: rows.length }));
        for (const row of candidates.filter(Boolean)) {
            const reference = row.proof_document_path;
            if (seen.has(reference)) continue;
            seen.add(reference);
            const parsed = parseStoredFileReference(reference);
            const metadata = { sample: row === rows[0] ? "oldest" : row === rows.at(-1) ? "newest" : "delivery_sample", fileFingerprint: fingerprint(reference), referenceKind: parsed ? "cld" : reference.startsWith("cld:") ? "invalid_cld" : /^https?:/.test(reference) ? "url" : "local", referenceLength: reference.length };
            if (parsed) {
                Object.assign(metadata, {
                    provider: parsed.provider === "cloudinary" ? "cloudinary" : "unsupported",
                    resourceType: ["image", "raw", "video"].includes(parsed.resourceType) ? parsed.resourceType : null,
                    deliveryType: ["upload", "authenticated", "private"].includes(parsed.type) ? parsed.type : null,
                    fileExtension: /^\.[a-z0-9]{1,8}$/i.test(path.extname(parsed.publicId || "")) ? path.extname(parsed.publicId).toLowerCase() : null,
                    publicIdHasFolders: typeof parsed.publicId === "string" && parsed.publicId.includes("/")
                });
                try {
                    const source = new URL(parsed.url);
                    const segments = source.pathname.split("/").filter(Boolean).map(decodeURIComponent);
                    const existingSignature = /^s--[A-Za-z0-9_-]+--$/.test(segments[3]);
                    const versionIndex = existingSignature ? 4 : 3;
                    const versioned = /^v\d+$/.test(segments[versionIndex]);
                    const assetPath = segments.slice(versioned ? versionIndex + 1 : versionIndex).join("/");
                    metadata.hasDeliverySignature = existingSignature;
                    metadata.hasVersion = versioned;
                    metadata.matchesConfiguredCloud = segments[0] === process.env.CLOUDINARY_CLOUD_NAME;
                    metadata.assetIdentityMatches = assetPath === parsed.publicId || parsed.resourceType === "image" && assetPath.startsWith(`${parsed.publicId}.`);
                    if (process.argv.includes("--probe") && source.hostname === "res.cloudinary.com" && source.protocol === "https:" && metadata.matchesConfiguredCloud) {
                        metadata.currentDownloadHelper = await probeHelper(reference);
                        if (parsed.type === "upload") metadata.legacyDelivery = await head(source.href);
                        if (["upload", "authenticated"].includes(parsed.type)) {
                            const resourcePath = segments.slice(3).join("/");
                            const sign = value => crypto.createHash("sha1").update(value + process.env.CLOUDINARY_API_SECRET).digest("base64url").slice(0, 8);
                            const delivery = signature => `https://res.cloudinary.com/${segments.slice(0, 3).join("/")}/s--${signature}--/${resourcePath}`;
                            metadata.versionIncludedSignature = await head(delivery(sign(resourcePath)));
                            const correctedPath = segments.slice(versionIndex).join("/");
                            const correctedUrl = `https://res.cloudinary.com/${segments.slice(0, 3).join("/")}/s--${sign(assetPath)}--/${correctedPath}`;
                            metadata.assetOnlySignature = await head(correctedUrl);
                            if (existingSignature) metadata.singleSignatureWithVersion = await head(`https://res.cloudinary.com/${segments.slice(0, 3).join("/")}/s--${sign(correctedPath)}--/${correctedPath}`);
                            if (existingSignature) metadata.originalProviderUrl = await head(source.href);
                            const privateUrl = privateDownloadSourceUrl(reference);
                            if (privateUrl) metadata.privateDownloadApi = await head(privateUrl);
                        }
                    }
                } catch { metadata.urlValid = false; }
            }
            console.log(JSON.stringify(metadata));
        }
    } catch (error) {
        console.error(JSON.stringify({ failure: "diagnostic_unavailable", code: /^[A-Z0-9_]+$/.test(error.original?.code || "") ? error.original.code : null }));
        process.exitCode = 1;
    } finally { await db.sequelize.close(); }
})();
