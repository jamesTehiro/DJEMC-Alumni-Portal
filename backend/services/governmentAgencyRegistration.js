"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { renderResumePdf } = require("./resumePdf");
const { isObjectStorageEnabled, uploadBuffer, destroyStoredFile } = require("./objectStorage");
const { sanitizeDownloadName } = require("../utils/storedFiles");

const IMAGE_LIMIT = 512 * 1024;
const TOTAL_IMAGE_LIMIT = 768 * 1024;
const PDF_LIMIT = 5 * 1024 * 1024;
const ORGANIZATION_TYPES = new Set(["private_business", "government_agency"]);
const REQUIRED_FIELDS = [
    "agency_name",
    "agency_classification",
    "office_address",
    "agency_email",
    "agency_contact_number",
    "representative_name",
    "representative_designation",
    "representative_department",
    "representative_email",
    "representative_contact_number",
    "signature_printed_name",
    "signature_designation",
    "date_signed"
];

const clean = value => String(value ?? "").trim();
const escapeHtml = value => clean(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[character]));

const parseDetails = value => {
    let details = value;
    if (typeof details === "string") {
        try { details = JSON.parse(details); }
        catch { throw Object.assign(new Error("Government agency details are invalid."), { status: 400 }); }
    }
    if (!details || typeof details !== "object" || Array.isArray(details)) {
        throw Object.assign(new Error("Government agency details are required."), { status: 400 });
    }
    const normalized = {};
    for (const [key, value] of Object.entries(details)) {
        if (typeof value !== "string" && value != null && !(key === "signature_declaration_accepted" && typeof value === "boolean")) {
            throw Object.assign(new Error("Government agency fields must be text."), { status: 400 });
        }
        normalized[key] = key === "signature_declaration_accepted" && typeof value === "boolean" ? String(value) : clean(value);
        if (normalized[key].length > 500) throw Object.assign(new Error("Government agency fields cannot exceed 500 characters."), { status: 400 });
    }
    for (const field of REQUIRED_FIELDS) {
        if (!normalized[field]) throw Object.assign(new Error(`Complete the required government agency field: ${field.replaceAll("_", " ")}.`), { status: 400 });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized.agency_email) ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized.representative_email)) {
        throw Object.assign(new Error("Enter valid agency and representative email addresses."), { status: 400 });
    }
    normalized.department_ministry = normalized.department_ministry || "";
    normalized.regional_office = normalized.regional_office || "";
    normalized.agency_website = normalized.agency_website || "";
    normalized.signature_declaration_accepted = normalized.signature_declaration_accepted === "true";
    if (!normalized.signature_declaration_accepted) {
        throw Object.assign(new Error("Confirm the government agency declaration and consent."), { status: 400 });
    }
    return normalized;
};

const isImage = (buffer, mimeType) => {
    if (!Buffer.isBuffer(buffer)) return false;
    if (mimeType === "image/png") return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if (mimeType === "image/jpeg") return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    return false;
};

const imageDataUrl = (file, label) => {
    if (!file) return "";
    if (!["image/png", "image/jpeg"].includes(file.mimetype) || !isImage(file.buffer, file.mimetype)) {
        throw Object.assign(new Error(`${label} must be a valid PNG or JPG image.`), { status: 415 });
    }
    if (file.buffer.length > IMAGE_LIMIT) throw Object.assign(new Error(`${label} must be no larger than 512 KB.`), { status: 413 });
    return `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
};

const createConsentHtml = (details, signature, seal) => {
    const logoPath = path.join(__dirname, "..", "..", "frontend", "alumni-portal", "public", "logo.png");
    const logo = fs.existsSync(logoPath) ? `data:image/png;base64,${fs.readFileSync(logoPath).toString("base64")}` : "";
    const row = (label, value) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value) || "&mdash;"}</td></tr>`;
    return `<!doctype html><html><head><meta charset="utf-8"><style>
        @page { size: A4; margin: 18mm 18mm 16mm; }
        * { box-sizing: border-box; }
        body { font: 10pt Arial, Helvetica, sans-serif; color: #17231d; line-height: 1.4; }
        .heading { text-align: center; border-bottom: 2px solid #164b32; padding-bottom: 12px; margin-bottom: 18px; }
        .logo { width: 68px; height: 68px; object-fit: contain; margin-bottom: 5px; }
        .college { font-size: 13pt; font-weight: 700; color: #164b32; }
        h1 { font-size: 15pt; line-height: 1.25; margin: 10px 0 0; }
        h2 { font-size: 11pt; color: #164b32; margin: 17px 0 6px; border-bottom: 1px solid #aebdb4; padding-bottom: 4px; }
        table { width: 100%; border-collapse: collapse; }
        th, td { border: 1px solid #cbd4ce; padding: 6px 8px; text-align: left; vertical-align: top; }
        th { width: 34%; background: #f1f5f2; font-weight: 600; }
        .declaration { margin-top: 16px; }
        .signatures { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; margin-top: 30px; break-inside: avoid; }
        .signature { width: 60%; }
        .seal { width: 26%; text-align: center; }
        .signature img { max-width: 240px; max-height: 90px; object-fit: contain; display: block; margin: 0 0 6px; }
        .seal img { max-width: 115px; max-height: 115px; object-fit: contain; }
        .line { border-top: 1px solid #26352c; padding-top: 5px; margin-top: 4px; }
        .fine { margin-top: 18px; font-size: 8pt; color: #4b5a51; }
    </style></head><body>
        <header class="heading">${logo ? `<img class="logo" src="${logo}" alt="">` : ""}
            <div class="college">Don Jose E. Memorial College</div>
            <h1>GOVERNMENT AGENCY REGISTRATION AND AUTHORIZATION FORM</h1>
        </header>
        <h2>Agency Information</h2><table>
            ${row("Government Agency / Office Name", details.agency_name)}
            ${row("Agency Type or Classification", details.agency_classification)}
            ${row("Department / Ministry", details.department_ministry)}
            ${row("Regional Office / Division", details.regional_office)}
            ${row("Complete Office Address", details.office_address)}
            ${row("Official Agency Email Address", details.agency_email)}
            ${row("Official Contact Number", details.agency_contact_number)}
            ${row("Agency Website", details.agency_website)}
        </table>
        <h2>Authorized Representative</h2><table>
            ${row("Full Name", details.representative_name)}
            ${row("Official Position / Designation", details.representative_designation)}
            ${row("Department / Office", details.representative_department)}
            ${row("Official Email Address", details.representative_email)}
            ${row("Contact Number", details.representative_contact_number)}
        </table>
        <h2>Declaration and Consent</h2>
        <p class="declaration">I declare that the information provided is accurate and complete; that I am authorized to register and manage this agency's employer account; and that the agency will use the portal for legitimate recruitment and employment-related purposes. I understand the information and documents submitted will undergo administrative verification and consent to their collection and processing for registration and verification.</p>
        <div class="signatures"><div class="signature">${signature ? `<img src="${signature}" alt="Authorized representative signature">` : ""}
            <div class="line"><strong>${escapeHtml(details.signature_printed_name)}</strong><br>${escapeHtml(details.signature_designation)}<br>Date signed: ${escapeHtml(details.date_signed)}</div>
        </div>${seal ? `<div class="seal"><img src="${seal}" alt="Official agency seal"><div>Official Agency Seal</div></div>` : ""}</div>
        <p class="fine">This document records the information submitted for administrative review. The uploaded signature image does not by itself establish legal authority. Declaration wording is pending institutional/legal review.</p>
    </body></html>`;
};

const generateConsentPdf = async (details, signatureFile, sealFile) => {
    const readFile = async file => file && !Buffer.isBuffer(file.buffer)
        ? { ...file, buffer: await fs.promises.readFile(file.path) }
        : file;
    signatureFile = await readFile(signatureFile);
    sealFile = await readFile(sealFile);
    const signature = imageDataUrl(signatureFile, "Authorized representative signature");
    const seal = imageDataUrl(sealFile, "Agency seal");
    if (!signature) throw Object.assign(new Error("An authorized representative signature image is required."), { status: 400 });
    const totalBytes = (signatureFile?.buffer?.length || 0) + (sealFile?.buffer?.length || 0);
    if (totalBytes > TOTAL_IMAGE_LIMIT) throw Object.assign(new Error("The signature and agency seal images must total no more than 768 KB."), { status: 413 });
    const html = createConsentHtml(details, signature, seal);
    return renderResumePdf(html);
};

const previewTokenSecret = () => {
    const secret = process.env.JWT_SECRET || process.env.JWT_REFRESH_SECRET;
    if (!secret) throw Object.assign(new Error("Government agency consent signing is not configured."), { status: 503 });
    return secret;
};

const fileHash = buffer => buffer ? crypto.createHash("sha256").update(buffer).digest("hex") : "";
const createPreviewToken = ({ details, signature, seal, pdf }) => {
    if (!Buffer.isBuffer(pdf) || pdf.length > PDF_LIMIT || !pdf.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
        throw Object.assign(new Error("The generated authorization PDF is invalid."), { status: 400 });
    }
    const payload = Buffer.from(JSON.stringify({
        expires_at: Date.now() + 30 * 60 * 1000,
        details_hash: crypto.createHash("sha256").update(JSON.stringify(details)).digest("hex"),
        signature_hash: fileHash(signature?.buffer),
        seal_hash: fileHash(seal?.buffer),
        pdf_hash: crypto.createHash("sha256").update(pdf).digest("hex")
    })).toString("base64url");
    const signatureValue = crypto.createHmac("sha256", previewTokenSecret()).update(payload).digest("base64url");
    return `${payload}.${signatureValue}`;
};

const verifyPreviewToken = async ({ token, details, signature, seal, pdf }) => {
    if (typeof token !== "string" || token.length > 2048 || !Buffer.isBuffer(pdf) ||
        pdf.length > PDF_LIMIT || !pdf.subarray(0, 5).equals(Buffer.from("%PDF-"))) return false;
    const secret = previewTokenSecret();
    const [payload, suppliedSignature, extra] = token.split(".");
    if (!payload || !suppliedSignature || extra) return false;
    const expectedSignature = crypto.createHmac("sha256", secret).update(payload).digest();
    let actualSignature;
    try { actualSignature = Buffer.from(suppliedSignature, "base64url"); }
    catch { return false; }
    if (actualSignature.length !== expectedSignature.length || !crypto.timingSafeEqual(actualSignature, expectedSignature)) return false;
    try {
        const read = async file => file ? Buffer.isBuffer(file.buffer) ? file.buffer : fs.promises.readFile(file.path) : null;
        const [signatureBuffer, sealBuffer] = await Promise.all([read(signature), read(seal)]);
        const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
        return Number.isFinite(claims.expires_at) && claims.expires_at > Date.now() &&
            claims.details_hash === crypto.createHash("sha256").update(JSON.stringify(details)).digest("hex") &&
            claims.signature_hash === fileHash(signatureBuffer) &&
            claims.seal_hash === fileHash(sealBuffer) &&
            claims.pdf_hash === crypto.createHash("sha256").update(pdf).digest("hex");
    } catch { return false; }
};

const storeConsentPdf = async buffer => {
    if (isObjectStorageEnabled()) {
        const uploaded = await uploadBuffer({
            buffer,
            mimeType: "application/pdf",
            originalName: "government-agency-registration-authorization.pdf",
            folder: "private_uploads/government_agencies",
            prefix: "registration-authorization",
            isPublic: false,
            deliveryType: "authenticated"
        });
        return {
            storage_ref: uploaded.storageRef,
            name: "government-agency-registration-authorization.pdf",
            mime_type: "application/pdf",
            size: buffer.length
        };
    }
    if (process.env.NODE_ENV === "production" || String(process.env.RENDER).toLowerCase() === "true") {
        throw Object.assign(new Error("Private government agency document storage is not configured."), { status: 503 });
    }
    const root = path.join(__dirname, "..", "private_uploads", "government_agencies");
    await fs.promises.mkdir(root, { recursive: true });
    const filename = `registration-authorization-${crypto.randomUUID()}.pdf`;
    await fs.promises.writeFile(path.join(root, filename), buffer, { flag: "wx", mode: 0o600 });
    return {
        storage_ref: `/private_uploads/government_agencies/${filename}`,
        name: filename,
        mime_type: "application/pdf",
        size: buffer.length
    };
};

const deleteLocalConsentPdf = async document => {
    if (!document?.storage_ref) return;
    if (document.storage_ref.startsWith("cld:")) {
        const removed = await destroyStoredFile(document.storage_ref, { verifyResult: true });
        if (!removed) throw new Error("Uncommitted authorization PDF could not be removed from object storage.");
        return;
    }
    const filename = path.basename(document.storage_ref);
    if (filename !== document.storage_ref.split("/").pop() || !/^registration-authorization-[0-9a-f-]+\.pdf$/i.test(filename)) return;
    await fs.promises.unlink(path.join(__dirname, "..", "private_uploads", "government_agencies", filename)).catch(error => {
        if (error.code !== "ENOENT") throw error;
    });
};

module.exports = {
    ORGANIZATION_TYPES,
    IMAGE_LIMIT,
    PDF_LIMIT,
    parseDetails,
    isImage,
    createConsentHtml,
    generateConsentPdf,
    createPreviewToken,
    verifyPreviewToken,
    storeConsentPdf,
    deleteLocalConsentPdf
};
