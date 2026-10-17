import { useState } from "react";
import { Button } from "react-bootstrap";
import { fetchFile } from "../services/api";
import { getBusinessPermitDocuments } from "../utils/businessPermits";

export default function BusinessPermitDocuments({ profile, onView }) {
    const documents = getBusinessPermitDocuments(profile);
    const [error, setError] = useState("");
    const [downloading, setDownloading] = useState(null);
    const download = async document => {
        setError(""); setDownloading(document.id);
        try {
            const blob = await fetchFile(`${document.url}${document.url.includes("?") ? "&" : "?"}download=1`, true);
            const url = URL.createObjectURL(blob);
            const link = window.document.createElement("a");
            link.href = url; link.download = document.name || "Business permit";
            window.document.body.appendChild(link); link.click(); link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (failure) { setError(failure.message || "The submitted business permit could not be downloaded."); }
        finally { setDownloading(null); }
    };
    return <section className="employer-permit-section" aria-label="Business Permit Documents">
        <h3 className="employer-details-label employer-permit-heading">Business Permit Documents</h3>
        {error && <p className="text-danger" role="alert">{error}</p>}
        {!documents.length && <p className="empty">No business permit documents were submitted with this registration.</p>}
        {documents.length > 0 && <ul className="list-unstyled">
            {documents.map(document => <li key={document.id} className="mb-3">
                <strong>{document.name}</strong>{" "}<span>{document.mime_type || "File"}</span>
                <div className="d-flex gap-2 mt-2">
                    <Button variant="outline-success" onClick={() => { setError(""); onView(document); }} aria-label={`View ${document.name}`}>View</Button>
                    <Button variant="outline-secondary" disabled={downloading !== null} onClick={() => download(document)} aria-label={`Download ${document.name}`}>{downloading === document.id ? "Downloading..." : "Download"}</Button>
                </div>
            </li>)}
        </ul>}
    </section>;
}
