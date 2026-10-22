const { getStoredFileOriginalName } = require("./objectStorage");

const fileMetadata = file => ({
    name: file.originalname || file.filename,
    mime_type: file.mimetype,
    size: file.size,
    storage_ref: file.storageRef || `/uploads/documents/${file.filename}`
});

const readProofDocuments = profile => {
    let documents = profile?.proof_documents;
    if (typeof documents === "string") {
        try { documents = JSON.parse(documents); } catch { documents = []; }
    }
    documents = Array.isArray(documents) ? documents.filter(document => typeof document?.storage_ref === "string" && document.storage_ref) : [];
    const reference = profile?.proof_document_path;
    if (reference && !documents.some(document => document.storage_ref === reference)) {
        documents = [{ storage_ref: reference, name: getStoredFileOriginalName(reference) || String(reference).split(/[/\\]/).pop() || "proof-document" }, ...documents];
    }
    return documents;
};

module.exports = { fileMetadata, readProofDocuments };
