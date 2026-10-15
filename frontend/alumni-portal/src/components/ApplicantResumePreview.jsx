import React, { useEffect, useId, useRef, useState } from "react";
import { fetchFile } from "../services/api";
import { createApplicantResumePreviewLoader, getApplicantDocumentFilename } from "../utils/applicantResume";
import "./ApplicantResumePreview.css";

function ResumeReader({ applicationId, document, onClose, onView, onDownload }) {
    const [preview, setPreview] = useState({ status: "loading" });
    const [attempt, setAttempt] = useState(0);
    const [imageZoom, setImageZoom] = useState(100);
    const heading = useRef(null);
    const titleId = useId();
    const filename = getApplicantDocumentFilename(document);

    useEffect(() => {
        const loader = createApplicantResumePreviewLoader({ fetchDocument: fetchFile, onChange: setPreview });
        loader.load(applicationId, document);
        return () => loader.dispose();
    }, [applicationId, document, attempt]);

    useEffect(() => {
        heading.current?.focus({ preventScroll: true });
        heading.current?.scrollIntoView?.({ block: "start", behavior: "smooth" });
    }, []);

    const readerFailed = () => setPreview((current) => ({ ...current, status: "error", message: "Your browser could not display this resume. Please try View or Download." }));

    return (
        <section className="applicant-resume-preview" aria-labelledby={titleId}>
            <div className="applicant-resume-preview-heading">
                <div>
                    <h4 id={titleId} ref={heading} tabIndex={-1}>Resume Preview</h4>
                    <p className="applicant-resume-preview-filename" title={filename}>{filename}</p>
                </div>
                {onClose && <button type="button" className="applicant-resume-preview-button" onClick={onClose} aria-label="Close resume preview">Close preview</button>}
            </div>
            <div className="applicant-resume-preview-actions">
                {onView && <button type="button" className="applicant-resume-preview-button" onClick={onView}>View</button>}
                {onDownload && <button type="button" className="applicant-resume-preview-button" onClick={onDownload}>Download</button>}
                {preview.status === "ready" && preview.type === "image" && (
                    <label className="applicant-resume-preview-zoom">Zoom
                        <select value={imageZoom} onChange={(event) => setImageZoom(Number(event.target.value))}>
                            {[100, 150, 200].map((value) => <option key={value} value={value}>{value}%</option>)}
                        </select>
                    </label>
                )}
            </div>
            {preview.status === "loading" && <p className="applicant-resume-preview-message" role="status">Loading resume…</p>}
            {preview.status === "unsupported" && <p className="applicant-resume-preview-message" role="status">This file format cannot be read in the browser. Use View or Download to open the resume in a compatible application.</p>}
            {preview.status === "error" && <div className="applicant-resume-preview-message" role="alert"><p>{preview.message}</p><button type="button" className="applicant-resume-preview-button" onClick={() => setAttempt((value) => value + 1)}>Try again</button></div>}
            {preview.status === "ready" && preview.type === "pdf" && <>
                <iframe className="applicant-resume-preview-pdf" src={preview.url} title={`Resume: ${filename}`} onError={readerFailed} />
                <p className="applicant-resume-preview-hint">If your browser does not show the PDF, use View or Download above.</p>
            </>}
            {preview.status === "ready" && preview.type === "image" && <div className="applicant-resume-preview-image-scroll"><img src={preview.url} alt={`Resume: ${filename}`} onError={readerFailed} style={{ width: `${imageZoom}%`, maxWidth: "none" }} /></div>}
        </section>
    );
}

export default function ApplicantResumePreview(props) {
    if (!props.document) return null;
    return <ResumeReader key={`${props.applicationId}:${props.document.isLegacyResume ? "legacy" : props.document.id}`} {...props} />;
}
