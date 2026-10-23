import { useId, useState } from "react";
import { ALUMNI_DOCUMENT_ACCEPT, MAX_ALUMNI_DOCUMENT_FILES, MAX_ALUMNI_DOCUMENT_MB, validateAlumniDocuments } from "../utils/alumniDocuments";

export default function AlumniDocumentInput({ files, onChange, disabled = false }) {
    const id = useId();
    const [error, setError] = useState("");
    const select = event => {
        const selected = [...files, ...Array.from(event.target.files || [])];
        event.target.value = "";
        const failure = validateAlumniDocuments(selected);
        setError(failure);
        if (!failure) onChange(selected);
    };
    return <div className="field">
        <label htmlFor={id}>TOR / Diploma (Proof of Graduation)</label>
        <input id={id} name="proof_document" type="file" multiple accept={ALUMNI_DOCUMENT_ACCEPT} disabled={disabled} onChange={select} aria-describedby={`${id}-help`} />
        <p id={`${id}-help`} className="upload-helper-text">Optional: upload up to six PDF, DOC, DOCX, PNG, JPG, JPEG, or WEBP documents, up to {MAX_ALUMNI_DOCUMENT_MB} MB each.</p>
        <p className="upload-helper-text" role="status" aria-label="Selected document count">{files.length}/{MAX_ALUMNI_DOCUMENT_FILES}</p>
        {error && <p className="auth-error" role="alert">{error}</p>}
        {files.length > 0 && <ul aria-label="Selected proof of graduation documents">
            {files.map((file, index) => <li key={`${file.name}:${index}`}>
                <span>{file.name}</span>{" "}
                <button type="button" className="inline-link-btn" disabled={disabled} aria-label={`Remove ${file.name}`} onClick={() => { onChange(files.filter((_, position) => position !== index)); setError(""); }}>Remove</button>
            </li>)}
        </ul>}
    </div>;
}
