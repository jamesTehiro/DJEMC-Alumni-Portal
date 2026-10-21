import { Fragment, useMemo, useState } from "react";
import { FiDownload, FiFileText, FiPrinter, FiUser } from "react-icons/fi";
import ApplicantResumePreview from "./ApplicantResumePreview";
import { fetchFile, resolveFileUrl } from "../services/api";
import { getApplicantDocumentEntries, getApplicantDocumentFilename, getApplicantResumeDocument } from "../utils/applicantResume";
import { openApplicantResumePrintView } from "../utils/applicantResumePrint";
import "./ApplicantDocumentWorkspace.css";

export function ApplicantResumePrintButton({ application }) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const print = async () => {
        if (busy) return;
        setBusy(true); setError("");
        try { await openApplicantResumePrintView(application, { fetchDocument: fetchFile }); }
        catch (error) { setError(error.message); }
        finally { setBusy(false); }
    };
    return <div className="applicant-resume-print-control">
        <button type="button" className="btn btn-outline-dark" disabled={busy || !getApplicantResumeDocument(application)} onClick={print}><FiPrinter aria-hidden="true" /> {busy ? "Preparing…" : "Print Resume"}</button>
        {error && <small role="alert">{error}</small>}
    </div>;
}

export default function ApplicantDocumentWorkspace({ application, onDownload, onView }) {
    const entries = useMemo(() => getApplicantDocumentEntries(application), [application]);
    const [selectedKey, setSelectedKey] = useState(() => (entries.find(entry => entry.kind === "resume" && entry.available) || entries.find(entry => entry.available) || entries[0])?.key);
    const [photoFailed, setPhotoFailed] = useState(false);
    const selected = entries.find(entry => entry.key === selectedKey) || entries[0];
    const name = application?.alumni?.name || application?.full_name || "Unknown Applicant";
    const photo = application?.alumni?.AlumniProfile?.avatar_url;
    return <div className="applicant-document-workspace">
        <header className="applicant-document-profile">
            <div className="applicant-document-photo">{photo && !photoFailed ? <img src={resolveFileUrl(photo)} alt={`${name}'s profile`} onError={() => setPhotoFailed(true)} /> : <FiUser aria-label="No profile photo" />}</div>
            <div><h2>{name}</h2><p>{application?.Job?.title || "Position Not Available"}</p><span>Submitted Requirements</span></div>
        </header>
        <div className="applicant-document-columns">
            <nav className="applicant-document-sidebar" aria-label="Applicant Documents">
                <h3>Applicant Documents</h3>
                <div className="applicant-document-list">
                    {entries.length === 0 && <p role="status">No document requirements or submitted files.</p>}
                    {entries.map((entry, index) => <Fragment key={entry.key}>
                    {entry.source !== "configured" && (index === 0 || entries[index - 1].source === "configured") && <h3 style={{ gridColumn: "1 / -1" }}>Other submitted documents</h3>}
                    <button type="button" className={`applicant-document-card${selected?.key === entry.key ? " selected" : ""}${entry.available ? "" : " unavailable"}`} aria-pressed={selected?.key === entry.key} onClick={() => setSelectedKey(entry.key)}>
                    <FiFileText aria-hidden="true" />
                    <span><strong>{entry.label}</strong><small>{entry.available ? getApplicantDocumentFilename(entry.document) : "Not submitted / unavailable"}</small>
                        {entry.source === "configured" && typeof entry.required === "boolean" && <small>{entry.required ? "Required" : "Optional"}</small>}
                        {entry.source !== "configured" && <small>{entry.source === "legacy" ? "Historical attachment" : "Additional attachment"}</small>}
                        {entry.reviewStatus && !["pending_review", "not_submitted"].includes(entry.reviewStatus) && <small className="applicant-document-review">{entry.reviewStatus.replaceAll("_", " ")}</small>}</span>
                </button></Fragment>)}</div>
            </nav>
            <section className="applicant-document-viewer" aria-label="Selected document">
                <header className="applicant-document-toolbar"><div><h3>{selected?.label || "Document"}</h3><p>{selected?.available ? getApplicantDocumentFilename(selected.document) : "No uploaded file available"}</p></div><button type="button" className="btn btn-outline-success" disabled={!selected?.available} onClick={() => onDownload(selected.document, application.id)}><FiDownload aria-hidden="true" /> Download</button></header>
                {selected?.available ? <ApplicantResumePreview applicationId={application.id} document={selected.document} documentLabel={selected.label} embedded onView={() => onView(selected.document, application.id)} /> : <div className="applicant-document-unavailable" role="status"><FiFileText aria-hidden="true" /><p>{entries.length ? "This document was not submitted or has no accessible file record." : "No document requirements or submitted files are available for this application."}</p></div>}
            </section>
        </div>
    </div>;
}
