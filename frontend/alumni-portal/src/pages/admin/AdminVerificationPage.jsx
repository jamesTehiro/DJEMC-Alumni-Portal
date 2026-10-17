import React, { useMemo, useState } from "react";
import { Button, Modal } from "react-bootstrap";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../services/api";

import useRenderDebug from "../../hooks/useRenderDebug";
import useStrictSafeEffect from "../../hooks/useStrictSafeEffect";
import AdminShell from "../../components/AdminShell";
import BusinessPermitPreview from "../../components/BusinessPermitPreview";
import BusinessPermitDocuments from "../../components/BusinessPermitDocuments";
import SectionHeader from "../../components/ui/SectionHeader";
import { ADMIN_SCOPE_META, clearSessionAndGoHome, getStoredUser, isAllowedAdminScope } from "./adminUtils";
import "../AdminEmployerPage.css";
import "./AdminVerificationPage.css";

export default function AdminVerificationPage({ role }) {
    useRenderDebug(`AdminVerificationPage:${role}`);
    const navigate = useNavigate();
    const [records, setRecords] = useState([]);
    const [message, setMessage] = useState("");
    const [error, setError] = useState("");
    const [selectedEmployer, setSelectedEmployer] = useState(null);
    const [previewFile, setPreviewFile] = useState(null);



    const [search, setSearch] = useState("");
    const [employerStatusTab, setEmployerStatusTab] = useState("pending");
    const [processingId, setProcessingId] = useState(null);
    const [rejectingEmployer, setRejectingEmployer] = useState(null);
    const [rejectionReason, setRejectionReason] = useState("Your account verification could not be approved because the required proof or supporting documents were incomplete or insufficient.");

    const user = useMemo(() => getStoredUser(), []);
    const isAllowed = isAllowedAdminScope(user, role);
    const scopeMeta = ADMIN_SCOPE_META[role];

    // Stable refs to track loading state without triggering re-renders



    const loadRecords = async () => {
        try {
            const data = await api.get(scopeMeta.usersEndpoint, true);
            setRecords(Array.isArray(data) ? data : []);
        } catch (err) {
            setError(err.message);
        }
    };

    useStrictSafeEffect(
        `AdminVerificationPage:init:${role}:${isAllowed}`,
        () => {
            if (!isAllowed) return undefined;
            loadRecords();
            return undefined;
        },
        [isAllowed, role, scopeMeta.usersEndpoint],
        { label: `AdminVerificationPage init (${role})` }
    );

    if (!isAllowed) {
        return (
            <div className="admin-employer-shell">
                <div className="admin-employer-center">
                    <div className="admin-employer-card">
                        <h3>{scopeMeta.label} Admin Access Only</h3>
                        <p>Please log in using an {scopeMeta.label} Admin account.</p>
                        <Link to="/admin/login">Go to Login</Link>
                    </div>
                </div>
            </div>
        );
    }

    const updateStatus = async (id, status, reason = "") => {
        if (processingId !== null) return;
        setMessage("");
        setError("");
        setProcessingId(id);
        try {
            const result = await api.put(`${scopeMeta.usersEndpoint}/${id}/status`, { status, ...(reason ? { reason } : {}) }, true);
            setMessage(result?.msg || `${scopeMeta.label} account updated.`);
            setRejectingEmployer(null);
            setSelectedEmployer(null);
            await loadRecords();
        } catch (err) {
            setError(err.message);
            await loadRecords();
        } finally {
            setProcessingId(null);
        }
    };


    const pendingCount = records.filter((item) => item.account_status === "pending").length;
    const approvedCount = records.filter((item) => item.account_status === "verified").length;
    const rejectedCount = records.filter((item) => item.account_status === "rejected").length;
    const statusRecords = role !== "employer" ? records : records.filter((item) =>
        employerStatusTab === "pending" ? item.account_status === "pending" :
            employerStatusTab === "approved" ? item.account_status === "verified" : item.account_status === "rejected"
    );
    const normalizedSearch = search.trim().toLowerCase();
    const visibleRecords = !normalizedSearch ? statusRecords : statusRecords.filter((item) =>
        [item.name, item.email, item.EmployerProfile?.organization_name, item.EmployerProfile?.contact_email]
            .some((value) => String(value || "").toLowerCase().includes(normalizedSearch))
    );

    const statusClass = (status) => {
        if (status === "verified") return "status-pill verified";
        if (status === "rejected" || status === "suspended") return "status-pill rejected";
        return "status-pill pending";
    };

    const jobStatusClass = (status) => {
        if (status === "approved") return "status-pill verified";
        if (status === "rejected") return "status-pill rejected";
        return "status-pill pending";
    };

    return (
        <AdminShell
            scope={role}
            title={role === "alumni" ? "Alumni Verification" : " Employer Verification "}
            subtitle={
                role === "alumni"
                    ? "Review alumni verification requests and update statuses."
                    : "Review employer verification submissions and complete checks."
            }
            onLogout={() => clearSessionAndGoHome(navigate)}
        >
            {message && <p className="notice success">{message}</p>}
            {error && <p className="notice error">{error}</p>}

            <section className="content-grid content-grid-single">
                <div className="queue-panel">
                    <SectionHeader
                        title={role === "alumni" ? "Alumni Verification" : "Employer Verification"}
                        meta={`${pendingCount} Pending`}
                    />

                    {role === "employer" && <div className="employer-verification-tabs" role="tablist" aria-label="Employer verification status">
                        {[
                            ["pending", `Pending Review (${pendingCount})`],
                            ["approved", `Approved Employers (${approvedCount})`],
                            ["rejected", `Rejected Employers (${rejectedCount})`]
                        ].map(([tab, label]) => (
                            <button
                                key={tab}
                                type="button"
                                role="tab"
                                aria-selected={employerStatusTab === tab}
                                className={employerStatusTab === tab ? "active" : ""}
                                onClick={() => setEmployerStatusTab(tab)}
                            >
                                {label}
                            </button>
                        ))}
                    </div>}

                    <div className="employer-verification-search">
                        <input
                            type="search"
                            aria-label={`Search ${role} verification records`}
                            placeholder={role === "employer" ? "Search by company name or email" : "Search by name or email"}
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                        />
                    </div>

                    <div className={`queue-table${role === "employer" ? ` employer-verification-table employer-verification-${employerStatusTab}` : ""}`}>
                        <div className="queue-row header">
                            <span>{role === "employer" ? "Employer / Company Name" : "User"}</span>
                            <span>{role === "employer" ? "Registered Email" : "Type"}</span>
                            <span>{role === "employer" ? employerStatusTab === "pending" ? "Date Submitted" : employerStatusTab === "approved" ? "Date Approved" : "Date Rejected" : "Verification Data"}</span>
                            {role === "employer" && employerStatusTab === "rejected" && <span>Rejection Reason</span>}
                            <span>Status</span>
                            <span></span>
                        </div>
                        {visibleRecords.map((item) => {
                            const name = role === "employer"
                                ? item.EmployerProfile?.organization_name || item.name
                                : item.name;
                            const initials = name?.[0]?.toUpperCase() || (role === "employer" ? "E" : "A");
                            const verificationData =
                                role === "employer"
                                    ? item.EmployerProfile?.organization_name || "Company Name"
                                    : item.AlumniProfile?.graduation_year || "Graduation Year";

                            return (
                                <div className={`queue-row${role === "employer" ? " employer-verification-row" : ""}`} key={item.id}>
                                    <div className="user-cell">
                                        <div className="avatar">{initials}</div>
                                        <div>
                                            <strong>{name}</strong>
                                            <p>{item.email}</p>
                                        </div>
                                    </div>
                                    <span className="pill">{role === "employer" ? item.email : "Alumni"}</span>
                                    <span>{role === "employer"
                                        ? (() => { const date = employerStatusTab === "pending" ? item.createdAt : item.verificationDecision?.decided_at; return date ? new Date(date).toLocaleDateString() : "—"; })()
                                        : verificationData}</span>
                                    {role === "employer" && employerStatusTab === "rejected" && <span>{item.verificationDecision?.reason || "Reason not recorded."}</span>}
                                    <span className={`${statusClass(item.account_status)}${role === "employer" && item.account_status === "verified" ? " approved" : ""}`}>
                                        {role === "employer" ? item.account_status === "verified" ? "Approved" : item.account_status === "rejected" ? "Rejected" : "Pending Review" : item.account_status === "pending" ? "Pending Review" : item.account_status}
                                    </span>
                                    <div className="actions">
                                        <details className="action-menu">
                                            <summary>Action</summary>
                                            {role === "employer" ? (
                                                <>
                                                    <button type="button" onClick={() => setSelectedEmployer(item)}>View</button>
                                                    {employerStatusTab === "pending" && <>
                                                        <button type="button" disabled={processingId !== null} onClick={() => { if (window.confirm("Approve this employer account?")) updateStatus(item.id, "verified"); }}>Approve</button>
                                                        <button type="button" disabled={processingId !== null} onClick={() => { setRejectingEmployer(item); setRejectionReason("Your account verification could not be approved because the required proof or supporting documents were incomplete or insufficient."); }}>Reject</button>
                                                    </>}
                                                </>
                                            ) : (
                                                <>
                                                    <button type="button" onClick={() => updateStatus(item.id, "verified")}>Approve</button>
                                                    <button type="button" onClick={() => updateStatus(item.id, "rejected")}>Reject</button>
                                                    <button type="button" onClick={() => updateStatus(item.id, "pending")}>Request Info</button>
                                                </>
                                            )}
                                        </details>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </section>


            {role === "employer" && (
                <>
                    <Modal
                        show={!!selectedEmployer}
                        onHide={() => setSelectedEmployer(null)}
                        centered
                        size="lg"
                        dialogClassName="employer-details-modal"
                    >
                        <Modal.Header closeButton>
                            <Modal.Title>Employer Registration Details</Modal.Title>
                        </Modal.Header>
                        <Modal.Body className="employer-details-body">
                            <div className="employer-details-grid">
                                <div className="employer-details-card">
                                    <p className="employer-details-label">Company Name</p>
                                    <p className="employer-details-value">
                                        {selectedEmployer?.EmployerProfile?.organization_name || selectedEmployer?.name || "N/A"}
                                    </p>
                                </div>
                                <div className="employer-details-card">
                                    <p className="employer-details-label">Registered Email</p>
                                    <p className="employer-details-value">{selectedEmployer?.email || "N/A"}</p>
                                </div>
                                <div className="employer-details-card">
                                    <p className="employer-details-label">Verification Status</p>
                                    <p className="employer-details-value">{selectedEmployer?.account_status === "verified" ? "Approved" : selectedEmployer?.account_status === "rejected" ? "Rejected" : "Pending Review"}</p>
                                </div>
                                <div className="employer-details-card">
                                    <p className="employer-details-label">Date Submitted</p>
                                    <p className="employer-details-value">{selectedEmployer?.createdAt ? new Date(selectedEmployer.createdAt).toLocaleString() : "N/A"}</p>
                                </div>
                                {!!selectedEmployer?.verificationDecision?.decided_at && <div className="employer-details-card">
                                    <p className="employer-details-label">Decision Date</p>
                                    <p className="employer-details-value">{new Date(selectedEmployer.verificationDecision.decided_at).toLocaleString()}</p>
                                </div>}
                                {selectedEmployer?.account_status === "rejected" && <div className="employer-details-card employer-details-card-wide">
                                    <p className="employer-details-label">Rejection Reason</p>
                                    <p className="employer-details-value">{selectedEmployer?.verificationDecision?.reason || "Reason not recorded."}</p>
                                </div>}
                                <div className="employer-details-card">
                                    <p className="employer-details-label">Company Contact Email</p>
                                    <p className="employer-details-value">
                                        {selectedEmployer?.EmployerProfile?.contact_email || selectedEmployer?.email || "N/A"}
                                    </p>
                                </div>
                                <div className="employer-details-card employer-details-card-wide">
                                    <p className="employer-details-label">Company Address</p>
                                    <p className="employer-details-value">
                                        {selectedEmployer?.EmployerProfile?.address || "N/A"}
                                    </p>
                                </div>
                                <div className="employer-details-card employer-details-card-wide">
                                    <p className="employer-details-label">Website / Facebook</p>
                                    <p className="employer-details-value">
                                        {selectedEmployer?.EmployerProfile?.website_url || "N/A"}
                                    </p>
                                </div>
                            </div>

                            <BusinessPermitDocuments profile={selectedEmployer?.EmployerProfile} onView={setPreviewFile} />
                        </Modal.Body>
                        <Modal.Footer>
                            {selectedEmployer?.account_status === "pending" && <>
                                <Button variant="success" disabled={processingId !== null} onClick={() => { if (window.confirm("Approve this employer account?")) updateStatus(selectedEmployer.id, "verified"); }}>Approve</Button>
                                <Button variant="danger" disabled={processingId !== null} onClick={() => { setRejectingEmployer(selectedEmployer); setRejectionReason("Your account verification could not be approved because the required proof or supporting documents were incomplete or insufficient."); }}>Reject</Button>
                            </>}
                            <Button variant="secondary" onClick={() => setSelectedEmployer(null)}>Close</Button>
                        </Modal.Footer>
                    </Modal>

                    <Modal show={!!previewFile} onHide={() => setPreviewFile(null)} centered fullscreen>
                        <Modal.Header closeButton>
                            <Modal.Title>Business Permit Preview</Modal.Title>
                        </Modal.Header>
                        <Modal.Body className="permit-preview-modal">
                            {previewFile && <BusinessPermitPreview path={previewFile.url} name={previewFile.name} />}
                        </Modal.Body>
                    </Modal>
                    <Modal show={!!rejectingEmployer} onHide={() => { if (processingId === null) setRejectingEmployer(null); }} centered>
                        <Modal.Header closeButton><Modal.Title>Reject Employer Verification</Modal.Title></Modal.Header>
                        <Modal.Body>
                            <label htmlFor="employer-rejection-reason">Rejection reason</label>
                            <textarea id="employer-rejection-reason" className="form-control" rows={5} value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value)} />
                            {!rejectionReason.trim() && <p className="notice error">A rejection reason is required.</p>}
                        </Modal.Body>
                        <Modal.Footer>
                            <Button variant="secondary" disabled={processingId !== null} onClick={() => setRejectingEmployer(null)}>Cancel</Button>
                            <Button variant="danger" disabled={processingId !== null || !rejectionReason.trim()} onClick={() => updateStatus(rejectingEmployer.id, "rejected", rejectionReason.trim())}>
                                {processingId === rejectingEmployer?.id ? "Processing..." : "Confirm Rejection"}
                            </Button>
                        </Modal.Footer>
                    </Modal>
                </>
            )}
        </AdminShell>
    );
}
