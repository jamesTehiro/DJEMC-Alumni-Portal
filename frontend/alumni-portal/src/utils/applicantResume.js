const normalize = (value) => String(value || "").trim();
const mime = (value) => normalize(value).split(";")[0].toLowerCase();

export function isResumeRequirement(requirement = {}, document = {}) {
    requirement ||= {};
    document ||= {};
    const code = normalize(requirement.requirement_code || document.requirement_code).toLowerCase();
    if (/^(?:resume|cv|resume_cv|updated_resume(?:_cv)?)$/.test(code)) return true;
    // A filename alone never identifies the requirement: a cover letter can be named resume.pdf.
    if (code && !code.startsWith("custom_")) return false;
    const label = normalize(requirement.label || requirement.requirement_label || document.requirement_label)
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (/cover\s*letter|recommendation|reference\s*letter/i.test(label)) return false;
    return /\bresume\b|\bcv\b|curriculum\s+vitae/i.test(label);
}

export function getApplicantDocumentFilename(document = {}) {
    return normalize(document?.original_filename || document?.original_file_name || document?.file_name) || "Uploaded document";
}

export function getApplicantResumeDocument(application = {}) {
    if (!application || typeof application !== "object") return null;
    const storedSnapshot = application.JobRequirementSnapshot?.snapshot_data;
    let snapshot = storedSnapshot;
    if (typeof snapshot === "string") {
        try { snapshot = JSON.parse(snapshot); } catch { snapshot = null; }
    }
    const groups = Array.isArray(snapshot?.groups) ? snapshot.groups : [];
    const ungrouped = Array.isArray(snapshot?.ungrouped) ? snapshot.ungrouped : [];
    const requirements = [
        ...groups.flatMap((group) => Array.isArray(group?.requirements) ? group.requirements : []),
        ...ungrouped,
    ].filter((item) => item && typeof item === "object");
    const documents = Array.isArray(application.ApplicationDocuments) ? application.ApplicationDocuments : [];
    const document = documents.find((entry) => {
        if (!entry || typeof entry !== "object") return false;
        const requirement = requirements.find((item) => item.requirement_code === entry.requirement_code);
        return isResumeRequirement(requirement, entry);
    });
    if (document) return document;
    // A dynamic application's old resume_path may hold a compatibility reference
    // to another upload. Only its captured requirement identifies a resume.
    if (storedSnapshot && (typeof storedSnapshot !== "object" || Object.keys(storedSnapshot).length)) return null;
    if (!application.resume_path && !application.resume_file_name) return null;
    const legacyName = normalize(application.resume_path).split(/[\\/]/).pop()?.split(/[?#]/)[0];
    return {
        isLegacyResume: true,
        requirement_code: "resume",
        file_name: normalize(application.resume_file_name) || legacyName || "Uploaded resume",
        mime_type: application.resume_mime_type || "",
    };
}

export function getApplicantResumeFileUrl(applicationId, document) {
    if (!applicationId || !document) return "";
    const base = `/api/applications/${encodeURIComponent(applicationId)}`;
    if (document.isLegacyResume) return `${base}/resume/file`;
    return document.id ? `${base}/documents/${encodeURIComponent(document.id)}/file` : "";
}

export function getApplicantResumePreviewType(document, blob) {
    const filename = getApplicantDocumentFilename(document).toLowerCase();
    const types = [mime(blob?.type), mime(document?.mime_type)];
    if (/\.docx?$/.test(filename) || types.some((type) => ["application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"].includes(type))) return "file";
    if (types.some((type) => ["image/jpeg", "image/png"].includes(type))) return "image";
    if (types.includes("application/pdf")) return "pdf";
    if (/\.(?:jpe?g|png)$/.test(filename)) return "image";
    if (/\.pdf$/.test(filename)) return "pdf";
    return "file";
}

// Own each request and temporary URL so switching applicants or closing the modal
// cannot display a late response from a previous resume.
export function createApplicantResumePreviewLoader({ fetchDocument, onChange, createObjectURL = URL.createObjectURL, revokeObjectURL = URL.revokeObjectURL }) {
    let generation = 0;
    let objectUrl = null;
    let disposed = false;
    const revoke = () => {
        if (objectUrl) revokeObjectURL(objectUrl);
        objectUrl = null;
    };
    return {
        async load(applicationId, document) {
            const request = ++generation;
            revoke();
            if (disposed) return;
            onChange({ status: "loading" });
            try {
                const path = getApplicantResumeFileUrl(applicationId, document);
                if (!path) throw new Error("This application is missing its resume file record.");
                const blob = await fetchDocument(path, true);
                if (disposed || request !== generation) return;
                const contentType = mime(blob?.type);
                if (!blob?.size || ["text/html", "application/xhtml+xml", "application/json", "image/svg+xml"].includes(contentType) || contentType.endsWith("+json")) {
                    throw new Error("The server did not return a readable resume. Please try View or Download.");
                }
                const type = getApplicantResumePreviewType(document, blob);
                if (type === "file") {
                    onChange({ status: "unsupported", type });
                    return;
                }
                const typedBlob = type === "pdf" && mime(blob.type) !== "application/pdf"
                    ? new Blob([blob], { type: "application/pdf" })
                    : blob;
                objectUrl = createObjectURL(typedBlob);
                onChange({ status: "ready", type, url: objectUrl });
            } catch (error) {
                if (!disposed && request === generation) onChange({ status: "error", message: error.message || "The resume could not be previewed." });
            }
        },
        dispose() {
            disposed = true;
            generation++;
            revoke();
        },
    };
}
