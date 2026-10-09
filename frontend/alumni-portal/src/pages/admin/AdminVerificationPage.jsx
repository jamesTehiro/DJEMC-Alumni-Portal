import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Modal } from "react-bootstrap";
import { Link, useNavigate } from "react-router-dom";
import { api, fetchFile, API_BASE_URL } from "../../services/api";

const getServerOrigin = () => {
    try {
        return API_BASE_URL.replace(/\/api$/, "");
    } catch {
        return typeof window !== "undefined" ? window.location.origin : "http://localhost:5000";
    }
};

const toAbsoluteUploadUrl = (url) => {
    if (!url) return "";
    if (url.startsWith("data:") || url.startsWith("http://") || url.startsWith("https://")) return url;
    if (url.startsWith("/uploads/")) return `${getServerOrigin()}${url}`;
    return url;
};
import useRenderDebug from "../../hooks/useRenderDebug";
import useStrictSafeEffect from "../../hooks/useStrictSafeEffect";
import AdminShell from "../../components/AdminShell";
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
    const [previewUrl, setPreviewUrl] = useState(null);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [previewError, setPreviewError] = useState("");

    const user = useMemo(() => getStoredUser(), []);
    const isAllowed = isAllowedAdminScope(user, role);
    const scopeMeta = ADMIN_SCOPE_META[role];

    // Stable refs to track loading state without triggering re-renders
    const previewLoadedRef = useRef(false);
    const blobUrlRef = useRef(null);

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

    const updateStatus = async (id, status) => {
        setMessage("");
        setError("");
        try {
            await api.put(`${scopeMeta.usersEndpoint}/${id}/status`, { status }, true);
            setMessage(`${scopeMeta.label} account updated.`);
            loadRecords();
        } catch (err) {
            setError(err.message);
        }
    };


    const pendingCount = records.filter((item) => item.account_status === "pending").length;

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

    const getPreviewType = (filePath) => {
        const value = String(filePath || "").toLowerCase();
        if (/\.(png|jpe?g|webp|gif)$/.test(value)) return "image";
        if (value.endsWith(".pdf")) return "pdf";
        return "file";
    };

    const toFileUrl = (filePath) => {
        const value = String(filePath || "").trim();
        if (!value) return null;

        if (value.startsWith("/")) {
            const parts = value.split("/").filter(Boolean);
            if (parts[0] === "uploads") {
                if (parts.length === 2) {
                    return value;
                }
                const folder = parts[1];
                const fileName = parts.slice(2).join("/");
                return `/api/files/${folder}/${encodeURIComponent(fileName)}`;
            }
            return value;
        }

        if (/^https?:\/\//i.test(value)) {
            try {
                const parsed = new URL(value);
                if (typeof window !== "undefined" && window.location.protocol === "https:" && parsed.protocol === "http:") {
                    return `${window.location.origin}${parsed.pathname}${parsed.search}${parsed.hash}`;
                }
            } catch {
                return value;
            }
            return value;
        }

        const uploadPathMatch = value.match(/(?:[/\\]uploads[/\\]([^/\\]+)[/\\])([^/\\]+)$/i);
        if (uploadPathMatch) {
            const folder = uploadPathMatch[1];
            const fileName = uploadPathMatch[2];
            return `/api/files/${folder}/${encodeURIComponent(fileName)}`;
        }

        return value;
    };

    // Stable cleanup - no dependencies that change
    const cleanupPreviewUrl = useCallback(() => {
        if (blobUrlRef.current) {
            URL.revokeObjectURL(blobUrlRef.current);
            blobUrlRef.current = null;
            setPreviewUrl(null);
        }
    }, []);

    // Stable load function - no dependencies that change
    const loadProtectedPreview = useCallback(async (filePath) => {
        if (!filePath) return;

        setPreviewError("");
        setPreviewLoading(true);
        try {
            const blob = await fetchFile(toFileUrl(filePath), true);
            const url = URL.createObjectURL(blob);
            blobUrlRef.current = url;
            setPreviewUrl(url);
        } catch (err) {
            setPreviewError(err.message || "Unable to load preview.");
        } finally {
            setPreviewLoading(false);
        }
    }, []);

    // Stable effect that only runs when selectedEmployer changes
    useEffect(() => {
        if (!selectedEmployer?.EmployerProfile?.business_permit_path) {
            cleanupPreviewUrl();
            previewLoadedRef.current = false;
            return undefined;
        }

        // Prevent re-fetch if already loaded for the current selected employer
        if (previewLoadedRef.current) return undefined;
        previewLoadedRef.current = true;

        loadProtectedPreview(selectedEmployer.EmployerProfile.business_permit_path);

        return () => {
            cleanupPreviewUrl();
            previewLoadedRef.current = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedEmployer?.EmployerProfile?.business_permit_path]);

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

                    <div className={`queue-table${role === "employer" ? " employer-verification-table" : ""}`}>
                        <div className="queue-row header">
                            <span>User</span>
                            <span>Type</span>
                            <span>Verification Data</span>
                            <span>Status</span>
                            <span></span>
                        </div>
                        {records.map((item) => {
                            const name = role === "employer"
                                ? item.EmployerProfile?.organization_name || item.name
                                : item.name;
                            const initials = name?.[0]?.toUpperCase() || (role === "employer" ? "E" : "A");
                            const verificationData =
                                role === "employer"
                                    ? item.EmployerProfile?.organization_name || "Company Name"
                                    : item.AlumniProfile?.graduation_year || "Graduation Year";

                            return (
                                <div className="queue-row" key={item.id}>
                                    <div className="user-cell">
                                        <div className="avatar">{initials}</div>
                                        <div>
                                            <strong>{name}</strong>
                                            <p>{item.email}</p>
                                        </div>
                                    </div>
                                    <span className="pill">{role === "employer" ? "Employer" : "Alumni"}</span>
                                    <span>{verificationData}</span>
                                    <span className={statusClass(item.account_status)}>
                                        {item.account_status === "pending" ? "Pending Review" : item.account_status}
                                    </span>
                                    <div className="actions">
                                        <details className="action-menu">
                                            <summary>Action</summary>
                                            <button type="button" onClick={() => updateStatus(item.id, "verified")}>Approve</button>
                                            <button type="button" onClick={() => updateStatus(item.id, "rejected")}>Reject</button>
                                            {role === "employer" ? (
                                                <button type="button" onClick={() => setSelectedEmployer(item)}>View Info</button>
                                            ) : (
                                                <button type="button" onClick={() => updateStatus(item.id, "pending")}>Request Info</button>
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
                                    <p className="employer-details-label">Gmail</p>
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

                            <div className="employer-permit-section">
                                <p className="employer-details-label employer-permit-heading">Business Permit File</p>
                                {!selectedEmployer?.EmployerProfile?.business_permit_path && <p className="empty">No business permit uploaded.</p>}
                                {!!selectedEmployer?.EmployerProfile?.business_permit_path && (
                                    <div className="employer-file-preview">
                                        {getPreviewType(selectedEmployer.EmployerProfile.business_permit_path) === "image" ? (
                                            <button
                                                type="button"
                                                className="permit-preview-trigger"
                                                onClick={() => setPreviewFile(selectedEmployer.EmployerProfile.business_permit_path)}
                                            >
                                                <img
                                                    src={previewUrl || undefined}
                                                    alt="Business permit preview"
                                                    className="permit-thumb"
                                                />
                                                <span className="permit-preview-caption">Click to enlarge permit image</span>
                                            </button>
                                        ) : (
                                            <button
                                                type="button"
                                                className="permit-preview-trigger permit-pdf-trigger"
                                                onClick={() => setPreviewFile(selectedEmployer.EmployerProfile.business_permit_path)}
                                            >
                                                <span className="permit-pdf-icon">PDF</span>
                                                <span>{selectedEmployer.EmployerProfile.business_permit_path.split("/").pop()}</span>
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>
                        </Modal.Body>
                        <Modal.Footer>
                            <Button variant="secondary" onClick={() => setSelectedEmployer(null)}>Close</Button>
                        </Modal.Footer>
                    </Modal>

                    <Modal show={!!previewFile} onHide={() => setPreviewFile(null)} centered fullscreen>
                        <Modal.Header closeButton>
                            <Modal.Title>Business Permit Preview</Modal.Title>
                        </Modal.Header>
                        <Modal.Body className="permit-preview-modal">
                            {previewLoading && <p>Loading preview...</p>}
                            {previewError && <p className="notice error">{previewError}</p>}
                            {!previewLoading && !previewError && (
                                getPreviewType(previewFile) === "image" ? (
                                    <img src={previewUrl || undefined} alt="Business permit full preview" className="permit-full-image" />
                                ) : (
                                    <iframe title="Business permit PDF preview" src={previewUrl || undefined} className="permit-pdf-frame" />
                                )
                            )}
                        </Modal.Body>
                    </Modal>
                </>
            )}
        </AdminShell>
    );
}
