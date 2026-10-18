import { useEffect, useState } from "react";
import { Alert, Spinner } from "react-bootstrap";

const MIME_BY_EXTENSION = {
    pdf: "application/pdf",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
};

export default function BusinessPermitPreview({ name, request }) {
    const [preview, setPreview] = useState(null);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let active = true;
        let objectUrl;
        setPreview(null);
        setError("");
        setLoading(true);

        request.then(result => {
            if (!active) return;
            if (result.error) {
                setError(result.error.message || "The business permit could not be retrieved. Please try again.");
                setLoading(false);
                return;
            }

            const extension = String(name || "").split(".").pop().toLowerCase();
            const blob = result.blob;
            const responseType = blob.type && blob.type !== "application/octet-stream" ? blob.type.split(";")[0].toLowerCase() : "";
            const type = responseType || MIME_BY_EXTENSION[extension];
            if (!type || !["application/pdf", "image/jpeg", "image/png"].includes(type)) {
                setError("This business permit format cannot be previewed. Supported formats are PNG, JPG, JPEG, and PDF.");
                setLoading(false);
                return;
            }

            const typedBlob = responseType ? blob : new Blob([blob], { type });
            objectUrl = URL.createObjectURL(typedBlob);
            setPreview({ url: objectUrl, type });
            setLoading(false);
        }).catch(failure => {
            if (!active) return;
            setError(failure.message || "The business permit could not be retrieved. Please try again.");
            setLoading(false);
        });

        return () => {
            active = false;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [name, request]);

    if (error) return <Alert variant="danger" role="alert">{error}</Alert>;
    if (loading || !preview) return <p role="status"><Spinner animation="border" size="sm" /> Loading business permit…</p>;

    if (preview.type === "application/pdf") {
        return <iframe
            className="permit-pdf-frame"
            title={name || "Business permit"}
            src={preview.url}
            onError={() => setError("Your browser could not display this PDF business permit.")}
        />;
    }

    return <img
        className="permit-full-image"
        src={preview.url}
        alt={name || "Submitted business permit"}
        onError={() => setError("The business permit image could not be displayed. The file may be damaged or incomplete.")}
    />;
}
