import { useId, useState } from "react";
import { BUSINESS_PERMIT_ACCEPT, MAX_BUSINESS_PERMIT_MB, validateBusinessPermits } from "../utils/businessPermits";

export default function BusinessPermitInput({ files, onChange, disabled = false }) {
    const id = useId();
    const [error, setError] = useState("");
    const select = event => {
        const selected = [...files, ...Array.from(event.target.files || [])];
        event.target.value = "";
        const failure = validateBusinessPermits(selected);
        setError(failure);
        if (!failure) onChange(selected);
    };
    return <div className="field">
        <label htmlFor={id}>Business Permit (BIR / DTI / SEC) <span className="required-mark">*</span></label>
        <input id={id} className="employer-file-input" type="file" multiple accept={BUSINESS_PERMIT_ACCEPT} required={!files.length} disabled={disabled} onChange={select} aria-describedby={`${id}-help`} />
        <p id={`${id}-help`} className="upload-helper-text">Upload one to five PNG, JPG, JPEG, or PDF documents, up to {MAX_BUSINESS_PERMIT_MB} MB each. These will be reviewed before your account is activated.</p>
        {error && <p className="auth-error" role="alert">{error}</p>}
        {files.length > 0 && <ul aria-label="Selected business permit documents">
            {files.map((file, index) => <li key={`${file.name}:${index}`}>
                <span>{file.name}</span>{" "}
                <button type="button" className="inline-link-btn" disabled={disabled} aria-label={`Remove ${file.name}`} onClick={() => { onChange(files.filter((_, position) => position !== index)); setError(""); }}>Remove</button>
            </li>)}
        </ul>}
    </div>;
}
