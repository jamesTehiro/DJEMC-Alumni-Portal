import { useEffect, useState } from "react";
import { Alert, Spinner } from "react-bootstrap";
import { fetchFile } from "../services/api";

export default function GraduationProofPreview({ path, name }) {
    const [preview, setPreview] = useState(null);
    const [error, setError] = useState("");
    const [inlineFailed, setInlineFailed] = useState(false);
    useEffect(() => {
        let active = true;
        let objectUrl;
        setPreview(null);
        setError("");
        setInlineFailed(false);
        fetchFile(path, true).then(blob => {
            if (!active) return;
            const extension = String(name).split(".").pop().toLowerCase();
            const fallback = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" }[extension];
            const type = blob.type && blob.type !== "application/octet-stream" ? blob.type.split(";")[0] : fallback || "application/octet-stream";
            objectUrl = URL.createObjectURL(new Blob([blob], { type }));
            setPreview({ url: objectUrl, type });
        }).catch(err => { if (active) setError(err.message || "The proof could not be retrieved. Please try again."); });
        return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
    }, [path, name]);
    if (error) return <Alert variant="danger">{error}</Alert>;
    if (!preview) return <p role="status"><Spinner animation="border" size="sm" /> Loading proof of graduation…</p>;
    return <>
        {!inlineFailed && ["image/jpeg", "image/png", "image/webp"].includes(preview.type)
            ? <img src={preview.url} alt={name} onError={() => setInlineFailed(true)} style={{ maxWidth: "100%", maxHeight: "70vh", objectFit: "contain" }} />
            : !inlineFailed && preview.type === "application/pdf"
                ? <iframe title={name} src={preview.url} onError={() => setInlineFailed(true)} style={{ width: "100%", height: "70vh", border: 0 }} />
                : <p>Inline preview is unavailable for this document. Use Open Document or Download.</p>}
        <p className="mt-3"><a href={preview.url} target="_blank" rel="noopener noreferrer">Open Document</a>{" · "}<a href={preview.url} download={name}>Download</a></p>
    </>;
}
