import { useEffect, useState } from "react";
import { Alert, Spinner } from "react-bootstrap";
import { fetchFile } from "../services/api";
import { prepareDocumentBlob } from "../utils/documentPreview";

export default function DocumentPreview({ path, request, blob, name = "Document" }) {
    const [preview, setPreview] = useState(null);
    const [error, setError] = useState("");
    const [inlineFailed, setInlineFailed] = useState(false);
    const [enlarged, setEnlarged] = useState(false);
    useEffect(() => {
        let active = true;
        let objectUrl;
        setPreview(null);
        setError("");
        setInlineFailed(false);
        setEnlarged(false);
        (async () => {
            const result = blob ? { blob } : request ? await request : { blob: await fetchFile(path, true) };
            if (result.error) throw result.error;
            const document = await prepareDocumentBlob(result.blob);
            if (!active) return;
            objectUrl = URL.createObjectURL(document.blob);
            setPreview({ ...document, url: objectUrl });
        })().catch(failure => { if (active) setError(failure.message || "The document could not be retrieved. Please try again."); });
        return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
    }, [path, request, blob]);
    if (error) return <Alert variant="danger">{error}</Alert>;
    if (!preview) return <p role="status"><Spinner animation="border" size="sm" /> Loading document…</p>;
    return <div className="document-preview">
        <p style={{ overflowWrap: "anywhere" }}><strong>{name}</strong> <small>({preview.type})</small></p>
        {preview.image && !inlineFailed ? <>
            <button type="button" className="btn btn-outline-success btn-sm mb-2" onClick={() => setEnlarged(value => !value)}>{enlarged ? "Fit image" : "Enlarge image"}</button>
            <div style={{ overflow: "auto", maxHeight: "70vh" }}><img src={preview.url} alt={name} onError={() => setInlineFailed(true)} style={enlarged ? { maxWidth: "none" } : { maxWidth: "100%", maxHeight: "70vh", objectFit: "contain" }} /></div>
        </> : preview.type === "application/pdf" && !inlineFailed
            ? <iframe title={name} src={preview.url} onError={() => setInlineFailed(true)} style={{ width: "100%", height: "70vh", border: 0 }} />
            : <p>Inline preview is unavailable for this document. Download the original file to open it.</p>}
        <p className="mt-3">{(preview.image || preview.type === "application/pdf") && <><a href={preview.url} target="_blank" rel="noopener noreferrer">Open Document</a>{" · "}</>}<a href={preview.url} download={name}>Download</a></p>
    </div>;
}
