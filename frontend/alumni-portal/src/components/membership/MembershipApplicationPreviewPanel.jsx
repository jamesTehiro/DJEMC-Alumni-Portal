import { useEffect, useRef, useState } from "react";
import { Button, Modal, Spinner } from "react-bootstrap";
import { FiDownload, FiPrinter, FiX } from "react-icons/fi";
import { api } from "../../services/api";
import { membershipFullName } from "../../utils/membershipApplication";
import { membershipSubmittedDate, requireMembershipPdf, waitForMembershipDocumentImages } from "../../utils/membershipDocument";
import { membershipStatus } from "../../utils/membershipManagement";

export default function MembershipApplicationPreviewPanel({ applicationId, onClose }) {
    const [application, setApplication] = useState(null);
    const [html, setHtml] = useState("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [tab, setTab] = useState("form");
    const [retry, setRetry] = useState(0);
    const [downloading, setDownloading] = useState(false);
    const [mobile, setMobile] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 1199px)").matches);
    const generation = useRef(0);
    const busy = useRef(false);

    useEffect(() => {
        const media = window.matchMedia("(max-width: 1199px)");
        const changed = event => setMobile(event.matches);
        media.addEventListener("change", changed);
        return () => media.removeEventListener("change", changed);
    }, []);
    useEffect(() => {
        const request = ++generation.current;
        let active = true;
        async function load() {
            setLoading(true); setError("");
            try {
                const [details, document] = await Promise.all([api.get(`/membership/admin/${applicationId}`, true), api.get(`/membership/admin/${applicationId}/document`, true)]);
                if (Number(details?.application?.id) !== Number(applicationId) || typeof document?.html !== "string" || !document.html.includes(`data-membership-application-id="${applicationId}"`)) throw new Error("The selected application could not be displayed. Please retry.");
                if (active && request === generation.current) { setApplication(details.application); setHtml(document.html); }
            } catch (failure) { if (active && request === generation.current) setError(failure.message); }
            finally { if (active && request === generation.current) setLoading(false); }
        }
        load();
        return () => { active = false; generation.current = request + 1; };
    }, [applicationId, retry]);

    const print = async () => {
        if (!html || loading) return;
        const request = generation.current;
        const popup = window.open("", "_blank", "width=1000,height=800");
        if (!popup) { setError("Please allow pop-ups for this portal to print the application."); return; }
        try {
            popup.opener = null;
            popup.document.open(); popup.document.write(html); popup.document.close();
            await popup.document.fonts?.ready;
            await waitForMembershipDocumentImages(popup.document);
            if (request !== generation.current) { popup.close(); return; }
            if (!popup.closed) { popup.focus(); popup.print(); }
        } catch { if (!popup.closed) popup.close(); if (request === generation.current) setError("The application could not be printed. Please try again."); }
    };
    const download = async () => {
        if (busy.current || !application || loading) return;
        busy.current = true; setDownloading(true); setError("");
        const request = generation.current;
        try {
            const blob = await requireMembershipPdf(await api.get(`/membership/admin/${application.id}/pdf`, true, { responseType: "blob", validateStatus: () => true }));
            if (request !== generation.current) return;
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement("a"); anchor.href = url; anchor.download = `DJEMC-Membership-Application-${application.id}.pdf`;
            document.body.appendChild(anchor); anchor.click(); anchor.remove();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (failure) { if (request === generation.current) setError(failure.message); }
        finally { if (request === generation.current) { busy.current = false; setDownloading(false); } }
    };
    const details = application ? [
        ["Alumni Name", application.applicant_name || membershipFullName(application)], ["Email", application.personal_details?.email],
        ["Graduation Year", application.graduation_year],
        ["Date Submitted", membershipSubmittedDate(application.submitted_at)], ["Application Status", membershipStatus(application.application_status).label],
        ...(application.reviewed_at ? [["Review Date", membershipSubmittedDate(application.reviewed_at)]] : []),
        ...(application.reviewer?.name ? [["Authorized Reviewer", application.reviewer.name]] : [])
    ] : [];
    const content = <>
        <div className="membership-preview-tabs" role="tablist" aria-label="Membership application preview">
            <button type="button" id="membership-form-tab" role="tab" aria-selected={tab === "form"} aria-controls="membership-preview-content" onClick={() => setTab("form")}>Application Form</button>
            <button type="button" id="membership-details-tab" role="tab" aria-selected={tab === "details"} aria-controls="membership-preview-content" onClick={() => setTab("details")}>Application Details</button>
        </div>
        <div className="membership-preview-body" id="membership-preview-content" role="tabpanel" aria-labelledby={tab === "form" ? "membership-form-tab" : "membership-details-tab"}>
            {loading && <p role="status"><Spinner size="sm" animation="border" /> Loading submitted application…</p>}
            {error && <div className="alert alert-danger" role="alert">{error}{!html && <Button variant="outline-success" size="sm" className="ms-2" onClick={() => setRetry(value => value + 1)}>Retry</Button>}</div>}
            {!loading && tab === "form" && html && <iframe className="membership-preview-document" sandbox="" title="Read-only membership application form" srcDoc={html} />}
            {!loading && tab === "details" && application && <dl className="membership-application-details">{details.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || "Not recorded"}</dd></div>)}</dl>}
        </div>
        <footer className="membership-preview-actions"><Button variant="success" onClick={download} disabled={loading || !application || downloading}><FiDownload /> {downloading ? "Preparing PDF…" : "Download (PDF)"}</Button><Button variant="outline-success" onClick={print} disabled={loading || !html}><FiPrinter /> Print</Button><Button variant="outline-secondary" onClick={onClose}>Close</Button></footer>
    </>;
    return mobile ? <Modal show fullscreen onHide={onClose} className="membership-preview-mobile" aria-labelledby="membership-preview-title">
        <Modal.Header closeButton><Modal.Title id="membership-preview-title">View Membership Application</Modal.Title></Modal.Header><Modal.Body>{content}</Modal.Body>
    </Modal> : <aside className="membership-preview-panel" aria-labelledby="membership-preview-title"><header><h2 id="membership-preview-title">View Membership Application</h2><button type="button" onClick={onClose} aria-label="Close application preview"><FiX /></button></header>{content}</aside>;
}
