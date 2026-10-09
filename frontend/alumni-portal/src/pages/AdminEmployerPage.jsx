import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Form, Modal } from "react-bootstrap";
import { Link, useNavigate } from "react-router-dom";
import { api, fetchFile, API_BASE_URL } from "../services/api";
import useRenderDebug from "../hooks/useRenderDebug";
import useStrictSafeEffect from "../hooks/useStrictSafeEffect";
import { useUndoDelete } from "../hooks/useUndoDelete";
import { getEmploymentTypeLabel } from "../utils/employmentTypes";
import AdminShell from "../components/AdminShell";
import "./AdminEmployerPage.css";
import "./EmployerPage.css";

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

export default function AdminEmployerPage({
    title = "Employer Administration",
    subtitle = "Monitor verifications, approvals, and platform health.",
    eyebrow = "Security Gate",
    showOverviewSections = true
}) {
    useRenderDebug("AdminEmployerPage");
    const { scheduleDelete } = useUndoDelete();
    const navigate = useNavigate();
    const [employers, setEmployers] = useState([]);
    const [jobs, setJobs] = useState([]);
    const [applications, setApplications] = useState([]);
    const [message, setMessage] = useState("");
    const [error, setError] = useState("");
    const [selectedEmployer, setSelectedEmployer] = useState(null);
    const [selectedApplication, setSelectedApplication] = useState(null);
    const [previewDocument, setPreviewDocument] = useState(null);
    const [previewDocumentError, setPreviewDocumentError] = useState("");
    const [previewDocumentLoading, setPreviewDocumentLoading] = useState(false);
    const documentPreviewUrlRef = useRef(null);
    const [verifyModalOpen, setVerifyModalOpen] = useState(false);
    const [reviewing, setReviewing] = useState(false);
    const [verifyForm, setVerifyForm] = useState({
        venue: "",
        place: "",
        date: "",
        time: "",
        contact_info: "",
        what_to_bring: ""
    });
    const applicantPrintRef = useRef(null);
    const [previewFile, setPreviewFile] = useState(null);
    const [previewUrl, setPreviewUrl] = useState(null);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [previewError, setPreviewError] = useState("");
    const [activeView, setActiveView] = useState("pendingAccounts");
    const [overviewFilterState, setOverviewFilter] = useState("pending_jobs");

    const user = useMemo(() => {
        try {
            return JSON.parse(localStorage.getItem("user") || "null");
        } catch {
            return null;
        }
    }, []);

    const isAllowed =
        user?.role === "admin" &&
        user?.admin_scope === "employer";

    const loadEmployers = async () => {
        try {
            const data = await api.get("/admin/employer/users", true);
            setEmployers(Array.isArray(data) ? data : []);
        } catch (err) {
            setError(err.message);
        }
    };

    const loadJobs = async () => {
        try {
            const data = await api.get("/admin/employer/jobs", true);
            setJobs(Array.isArray(data) ? data : []);
        } catch (err) {
            setError(err.message);
        }
    };

    const loadApplications = async () => {
        try {
            const data = await api.get("/admin/employer/applications", true);
            setApplications(Array.isArray(data) ? data : []);
        } catch (err) {
            setError(err.message);
        }
    };

    const previewLoadedRef = useRef(false);
    const blobUrlRef = useRef(null);

    const cleanupPreviewUrl = useCallback(() => {
        if (blobUrlRef.current) {
            URL.revokeObjectURL(blobUrlRef.current);
            blobUrlRef.current = null;
            setPreviewUrl(null);
        }
    }, []);

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

    useEffect(() => {
        if (!selectedEmployer?.EmployerProfile?.business_permit_path) {
            cleanupPreviewUrl();
            previewLoadedRef.current = false;
            return undefined;
        }

        if (previewLoadedRef.current) return undefined;
        previewLoadedRef.current = true;

        loadProtectedPreview(selectedEmployer.EmployerProfile.business_permit_path);

        return () => {
            cleanupPreviewUrl();
            previewLoadedRef.current = false;
        };
    }, [selectedEmployer?.EmployerProfile?.business_permit_path]);

    useStrictSafeEffect(
        `AdminEmployerPage:init:${isAllowed}`,
        () => {
            if (!isAllowed) return undefined;
            loadEmployers();
            loadJobs();
            loadApplications();
            return undefined;
        },
        [isAllowed],
        { label: "AdminEmployerPage init" }
    );

    const handleLogout = () => {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        navigate("/");
    };

    const handleDeleteJob = (job) => {
        setJobs((prev) => prev.filter((j) => j.id !== job.id));
        scheduleDelete({
            item: job,
            itemName: job.title || "Job",
            message: "The job was deleted.",
            deleteAction: () => api.delete(`/admin/employer/jobs/${job.id}`, true),
            restoreAction: () => {
                setJobs((prev) => {
                    const exists = prev.find((j) => j.id === job.id);
                    if (exists) return prev;
                    return [...prev, job].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
                });
            },
        });
    };

    const handleVerifyFormChange = (e) => {
        const { name, value } = e.target;
        setVerifyForm((prev) => ({ ...prev, [name]: value }));
    };

    const openVerifyModal = () => {
        setError("");
        setVerifyForm({
            venue: "",
            place: selectedApplication?.Job?.User?.EmployerProfile?.address || "",
            date: "",
            time: "",
            contact_info: selectedApplication?.Job?.User?.email || "",
            what_to_bring: ""
        });
        setVerifyModalOpen(true);
    };

    const reviewApplication = async (status, extraPayload = {}) => {
        if (!selectedApplication?.id) return;

        setReviewing(true);
        setMessage("");
        setError("");

        try {
            await api.put(`/admin/employer/applications/${selectedApplication.id}/review`, { status, ...extraPayload }, true);
            setMessage(
                status === "verified"
                    ? "Applicant marked as verified. Interview details saved and notification sent."
                    : "Applicant marked as not verified. Notification sent."
            );
            setVerifyModalOpen(false);
            setSelectedApplication(null);
            setVerifyForm({
                venue: "",
                place: "",
                date: "",
                time: "",
                contact_info: "",
                what_to_bring: ""
            });
            await loadJobs();
            await loadApplications();
        } catch (err) {
            setError(err.message);
        } finally {
            setReviewing(false);
        }
    };

    const handlePrintApplication = () => {
        if (!applicantPrintRef.current) return;
        const printWindow = window.open("", "_blank", "width=980,height=820");
        if (!printWindow) return;

        const styles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))
            .map((node) => node.outerHTML)
            .join("\n");

        printWindow.document.write(`<!DOCTYPE html><html><head><title>Applicant Details</title>${styles}<style>body{background:#fff;margin:0;padding:24px;font-family:Georgia,"Times New Roman",serif}.applicant-print-sheet{max-width:900px;margin:0 auto}.resume-avatar{print-color-adjust:exact;-webkit-print-color-adjust:exact}</style></head><body>${applicantPrintRef.current.outerHTML}</body></html>`);
        printWindow.document.close();
        printWindow.focus();
        printWindow.onload = () => {
            printWindow.print();
            printWindow.onafterprint = () => printWindow.close();
        };
    };

    const openApplicationDetails = async (application) => {
        if (!application) return;

        const alumniId = application?.alumni?.id;
        if (!alumniId) {
            setSelectedApplication(application);
            return;
        }

        try {
            const latestProfile = await api.get(`/profile/${alumniId}`, true);
            setSelectedApplication({
                ...application,
                alumni: {
                    ...application.alumni,
                    ...latestProfile,
                    AlumniProfile: latestProfile?.AlumniProfile || application.alumni?.AlumniProfile
                }
            });
        } catch {
            setSelectedApplication(application);
        }
    };

    const statusClass = (status) => {
        if (status === "verified") return "status-pill verified";
        if (status === "rejected") return "status-pill rejected";
        if (status === "suspended") return "status-pill rejected";
        return "status-pill pending";
    };

    const jobStatusClass = (status) => {
        if (status === "approved") return "status-pill verified";
        if (status === "rejected") return "status-pill rejected";
        return "status-pill verified";
    };

    if (!isAllowed) {
        return (
            <div className="admin-employer-shell">
                <div className="admin-employer-center">
                    <div className="admin-employer-card">
                        <h3>Employer Admin Access Only</h3>
                        <p>Please log in using an Employer Admin account.</p>
                        <Link to="/admin/login">Go to Login</Link>
                    </div>
                </div>
            </div>
        );
    }

    const pendingEmployers = employers.filter((e) => e.account_status === "pending").length;
    const verifiedEmployers = employers.filter((e) => e.account_status === "verified").length;
    const pendingJobs = 0;
    const approvedJobs = jobs.filter((j) => j.approval_status === "approved").length;

    // FIXED: Use same definition as Applicant Management - all jobs from the /admin/employer/jobs endpoint
    const activeJobOpenings = jobs;
    const pendingJobQueue = [];

    const overviewFilter = showOverviewSections
        ? activeView === "pendingAccounts" ? "pending_employers"
            : activeView === "verifiedEmployers" ? "verified_employers"
                : activeView === "activeJobs" ? "active_jobs"
                    : "pending_jobs"
        : overviewFilterState;

    const overviewPanelTitle =
        activeView === "verifiedEmployers" ? "Verified Employers"
            : activeView === "activeJobs" ? "Active Job Openings"
                : activeView === "pendingJobs" ? "Pending Jobs"
                    : "Pending Accounts";

    const renderOverviewContent = () => {
        const CardEmpty = ({ text }) => <p className="empty-jobs">{text}</p>;

        if (overviewFilter === "active_jobs") {
            const list = activeJobOpenings;
            return (
                <div className="queue-table queue-table-simple">
                    <div className="queue-row header queue-row-simple" style={{ display: "none" }}>
                        <span>Job Title</span>
                        <span>Company</span>
                        <span>Location</span>
                        <span>Posted Date</span>
                        <span>Status</span>
                    </div>
                    {list.length === 0 ? (
                        <CardEmpty text="No active job openings." />
                    ) : (
                        list.map((job) => {
                            const company = job.User?.EmployerProfile?.organization_name || job.User?.name || "—";
                            return (
                                <div className="emp-list-item" key={job.id}>
                                    <div className="emp-list-item-left">
                                        <strong>{job.title}</strong>
                                        <p>
                                            {company} | {job.location}
                                            {job.expected_salary ? ` • ${job.expected_salary}` : ""}
                                        </p>
                                    </div>
                                    <div className="emp-list-item-right">
                                        <span className="emp-status-badge approved">
                                            Active
                                        </span>
                                        <span className="emp-type-tag">{getEmploymentTypeLabel(job.employment_type)}</span>
                                        <button type="button" className="emp-delete-btn" onClick={() => handleDeleteJob(job)} title="Delete job">
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                                        </button>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            );
        }

        if (overviewFilter === "pending_employers") {
            const list = employers.filter((e) => e.account_status === "pending");
            return (
                <div className="queue-table queue-table-simple">
                    <div className="queue-row header queue-row-simple">
                        <span>Employer Name</span>
                        <span>Email</span>
                        <span>Registration Date</span>
                        <span>Status</span>
                    </div>
                    {list.length === 0 ? (
                        <CardEmpty text="No pending employers." />
                    ) : (
                        list.map((employer) => (
                            <div className="queue-row queue-row-simple" key={employer.id}>
                                <span>
                                    {employer.EmployerProfile?.organization_name || employer.name}
                                </span>
                                <span>{employer.email}</span>
                                <span>{employer.createdAt ? new Date(employer.createdAt).toLocaleDateString() : "—"}</span>
                                <span className={statusClass(employer.account_status)}>
                                    {employer.account_status}
                                </span>
                            </div>
                        ))
                    )}
                </div>
            );
        }

        if (overviewFilter === "verified_employers") {
            const list = employers.filter((e) => e.account_status === "verified");
            return (
                <div className="queue-table queue-table-simple">
                    <div className="queue-row header queue-row-simple queue-row-3col">
                        <span>Employer Name</span>
                        <span>Email</span>
                        <span>Registration Date</span>
                    </div>
                    {list.length === 0 ? (
                        <CardEmpty text="No verified employers." />
                    ) : (
                        list.map((employer) => (
                            <div className="queue-row queue-row-simple queue-row-3col" key={employer.id}>
                                <span>
                                    {employer.EmployerProfile?.organization_name || employer.name}
                                </span>
                                <span>{employer.email}</span>
                                <span>{employer.createdAt ? new Date(employer.createdAt).toLocaleDateString() : "—"}</span>
                            </div>
                        ))
                    )}
                </div>
            );
        }

        // Default: Verification Queue (Pending Accounts)
        const list = employers.filter((e) => e.account_status === "pending");
        return (
            <div className="queue-table queue-table-simple">
                <div className="queue-row header queue-row-simple">
                    <span>Employer Name</span>
                    <span>Email</span>
                    <span>Registration Date</span>
                    <span>Status</span>
                </div>
                {list.length === 0 ? (
                    <CardEmpty text="No pending employers." />
                ) : (
                    list.map((employer) => (
                        <div className="queue-row queue-row-simple" key={employer.id}>
                            <span>{employer.EmployerProfile?.organization_name || employer.name}</span>
                            <span>{employer.email}</span>
                            <span>{employer.createdAt ? new Date(employer.createdAt).toLocaleDateString() : "—"}</span>
                            <span className={statusClass(employer.account_status)}>{employer.account_status}</span>
                        </div>
                    ))
                )}
            </div>
        );
    };

    const getPreviewType = (documentEntry, blob) => {
        const fileName = String(documentEntry?.file_name || "").toLowerCase();
        const mimeTypes = [blob?.type, documentEntry?.mime_type]
            .map((value) => String(value || "").split(";")[0].trim().toLowerCase());
        const imageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/bmp"]);
        if (mimeTypes.some((type) => imageTypes.has(type)) || /\.(png|jpe?g|webp|gif|bmp)$/.test(fileName)) return "image";
        if (mimeTypes.includes("application/pdf") || fileName.endsWith(".pdf")) return "pdf";
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

        const winPathMatch = value.match(/^[A-Za-z]:\\(?:.*[/\\])?uploads[/\\]([^/\\]+)[/\\]([^/\\]+)$/i);
        if (winPathMatch) {
            return `/api/files/${winPathMatch[1]}/${encodeURIComponent(winPathMatch[2])}`;
        }

        const fileProtocolMatch = value.match(/^file:\/\/(?:[A-Za-z]:)?[/\\]?(?:.*[/\\])?uploads[/\\]([^/\\]+)[/\\]([^/\\]+)$/i);
        if (fileProtocolMatch) {
            return `/api/files/${fileProtocolMatch[1]}/${encodeURIComponent(fileProtocolMatch[2])}`;
        }
        return value;
    };

    const previewDocumentFile = async (documentEntry, applicationId) => {
        if (!applicationId || !documentEntry?.id) {
            setPreviewDocumentError("This application document is missing its file record.");
            setPreviewDocument(null);
            return;
        }

        if (documentPreviewUrlRef.current) URL.revokeObjectURL(documentPreviewUrlRef.current);
        documentPreviewUrlRef.current = null;
        setPreviewDocument(null);
        setPreviewDocumentLoading(true);
        setPreviewDocumentError("");

        try {
            const fileUrl = `/api/applications/${encodeURIComponent(applicationId)}/documents/${encodeURIComponent(documentEntry.id)}/file`;
            const blob = await fetchFile(fileUrl, true);
            if (!blob.size || ["text/html", "application/json"].includes(blob.type)) {
                throw new Error("The server did not return the uploaded document. Please try again or contact support.");
            }
            const previewType = getPreviewType(documentEntry, blob);
            const objectUrl = URL.createObjectURL(blob);
            documentPreviewUrlRef.current = objectUrl;
            setPreviewDocument({
                url: objectUrl,
                type: previewType,
                fileName: documentEntry.file_name || "document"
            });
        } catch (error) {
            setPreviewDocumentError(error.message || "The document could not be previewed.");
            setPreviewDocument(null);
        } finally {
            setPreviewDocumentLoading(false);
        }
    };

    const closeDocumentPreview = () => {
        if (documentPreviewUrlRef.current) URL.revokeObjectURL(documentPreviewUrlRef.current);
        documentPreviewUrlRef.current = null;
        setPreviewDocument(null);
        setPreviewDocumentError("");
    };

    const downloadPreviewDocument = () => {
        if (!previewDocument?.url) return;
        const link = document.createElement("a");
        link.href = previewDocument.url;
        link.download = String(previewDocument.fileName || "document").replace(/[\\/:*?"<>|\r\n]/g, "_");
        document.body.appendChild(link);
        link.click();
        link.remove();
    };

    if (showOverviewSections) {
        return (
            <AdminShell
                scope="employer"
                title={title}
                subtitle={subtitle}
                eyebrow={eyebrow}
                onLogout={handleLogout}
            >
                <div className="admin-main-content">
                    {message && <p className="notice success">{message}</p>}
                    {error && <p className="notice error">{error}</p>}

                    <section className="metric-grid">
                        <button
                            type="button"
                            className={`metric-card metric-overview-card metric-card-queue${activeView === "pendingAccounts" ? " active" : ""}`}
                            onClick={() => setActiveView("pendingAccounts")}
                        >
                            <div className="metric-icon amber">Q</div>
                            <div>
                                <p className="metric-label">Verification Queue</p>
                                <h3>{pendingEmployers}</h3>
                                <span>Pending Accounts</span>
                            </div>
                        </button>

                        <button
                            type="button"
                            className={`metric-card metric-overview-card metric-card-verified${activeView === "verifiedEmployers" ? " active" : ""}`}
                            onClick={() => setActiveView("verifiedEmployers")}
                        >
                            <div className="metric-icon blue">V</div>
                            <div>
                                <p className="metric-label">Verified Employers</p>
                                <h3>{verifiedEmployers}</h3>
                                <span>Employer Accounts</span>
                            </div>
                        </button>

                        <button
                            type="button"
                            className={`metric-card metric-overview-card metric-card-active${activeView === "activeJobs" ? " active" : ""}`}
                            onClick={() => setActiveView("activeJobs")}
                        >
                            <div className="metric-icon green">J</div>
                            <div>
                                <p className="metric-label">Active Job Openings</p>
                                <h3>{jobs.length}</h3>
                                <span>Active Postings</span>
                            </div>
                        </button>
                    </section>

                    <section className="content-grid overview-content-grid">
                        <div className="queue-panel overview-queue-panel">
                            <div className="panel-header">
                                <h2>{overviewPanelTitle}</h2>
                                <span>Read-only list</span>
                            </div>

                            {renderOverviewContent()}
                        </div>
                    </section>
                </div>
            </AdminShell>
        );
    }

    return (
        <AdminShell
            scope="employer"
            title={title}
            subtitle={subtitle}
            eyebrow={eyebrow}
            onLogout={handleLogout}
        >
            <div className="admin-main-content">
                {message && <p className="notice success">{message}</p>}
                {error && <p className="notice error">{error}</p>}

                <section className="content-grid admin-applicant-management-layout">
                    <div className="queue-panel">
                        <div className="panel-header">
                            <h2>Applicant List</h2>
                            <span>All applicants loaded from existing application data.</span>
                        </div>
                        {applications.length === 0 ? (
                            <p className="empty-jobs">No applications yet.</p>
                        ) : (
                            <div className="admin-applicant-list">
                                {applications.map((applicant) => (
                                    <div key={applicant.id} className="job-item-min">
                                        <div>
                                            <strong>{applicant.alumni?.name || applicant.full_name || "Unknown Applicant"}</strong>
                                            <p>
                                                {applicant.Job?.title || "Job"} | {applicant.status || "pending"} | {applicant.createdAt ? new Date(applicant.createdAt).toLocaleDateString() : "N/A"}
                                            </p>
                                            <p>{applicant.alumni?.email || applicant.email || "N/A"}</p>
                                        </div>
                                        <Button
                                            variant="outline-success"
                                            size="sm"
                                            onClick={() => openApplicationDetails(applicant)}
                                        >
                                            View Application
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                </section>
            </div>
            <Modal
                show={!!selectedApplication}
                onHide={() => {
                    setVerifyModalOpen(false);
                    setSelectedApplication(null);
                }}
                centered
                size="lg"
                scrollable
                dialogClassName="resume-dialog"
                contentClassName="resume-content"
                backdropClassName="resume-backdrop"
            >
                <Modal.Header closeButton>
                    <Modal.Title>Applicant Details</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    {(() => {
                        const app = selectedApplication || {};
                        const snapshot = app?.JobRequirementSnapshot;
                        const hasDynamicRequirements = snapshot && snapshot.snapshot_data;

                        // ── DYNAMIC REQUIREMENTS VIEW ──
                        if (hasDynamicRequirements) {
                            const snapshotData = snapshot.snapshot_data;
                            const allRequirements = [
                                ...(snapshotData.groups || []).flatMap((g) => g.requirements || []),
                                ...(snapshotData.ungrouped || [])
                            ];
                            const documents = app?.ApplicationDocuments || [];
                            const responses = app?.ApplicationResponses || [];

                            const getDocument = (code) => documents.find((d) => d.requirement_code === code);
                            const getResponse = (code) => responses.find((r) => r.requirement_code === code);

                            const renderReviewBadge = (status) => {
                                if (!status || status === "pending_review" || status === "not_submitted") return null;
                                const cls = status === "approved" ? "badge bg-success" : status === "rejected" ? "badge bg-danger" : "badge bg-warning text-dark";
                                return <span className={cls} style={{ marginLeft: 8 }}>{status}</span>;
                            };

                            return (
                                <div className="applicant-print-sheet" ref={applicantPrintRef}>
                                    <div className="applicant-print-header">
                                        <div
                                            className={`resume-avatar ${app?.alumni?.AlumniProfile?.avatar_url ? "with-photo" : ""}`}
                                            style={
                                                app?.alumni?.AlumniProfile?.avatar_url
                                                    ? { backgroundImage: `url(${app.alumni.AlumniProfile.avatar_url})` }
                                                    : undefined
                                            }
                                            aria-label="Applicant avatar"
                                        >
                                            {!app?.alumni?.AlumniProfile?.avatar_url &&
                                                (app?.alumni?.name?.[0]?.toUpperCase() || "A")}
                                        </div>
                                        <div className="applicant-print-identity">
                                            <h3>{app?.alumni?.name || app?.full_name || "Unknown Applicant"}</h3>
                                            <p>{app?.Job?.title || "Position Not Available"}</p>
                                            <span>Submitted Requirements</span>
                                        </div>
                                    </div>

                                    {snapshotData.groups && snapshotData.groups.length > 0 && snapshotData.groups.map((group, gi) => (
                                        <div className="applicant-print-section" key={`group-${gi}`}>
                                            <h5>{group.group_label || `Group ${gi + 1}`}</h5>
                                            <div className="applicant-print-grid">
                                                {(group.requirements || []).map((req) => {
                                                    const doc = getDocument(req.requirement_code);
                                                    const resp = getResponse(req.requirement_code);
                                                    return (
                                                        <div className="applicant-print-item applicant-print-item-wide" key={req.requirement_code}>
                                                            <span>{req.label}{req.required ? " *" : ""}</span>
                                                            <strong>
                                                                {req.requirement_type === "document_upload" ? (
                                                                    doc ? (
                                                                        <button type="button" className="applicant-document-link" onClick={() => previewDocumentFile(doc, app.id)}>
                                                                            {doc.file_name || "View Document"}
                                                                        </button>
                                                                    ) : (
                                                                        "Not submitted"
                                                                    )
                                                                ) : (
                                                                    resp ? resp.response_value : "Not submitted"
                                                                )}
                                                                {renderReviewBadge(doc?.review_status || resp?.review_status)}
                                                            </strong>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    ))}

                                    {snapshotData.ungrouped && snapshotData.ungrouped.length > 0 && (
                                        <div className="applicant-print-section">
                                            <h5>Other Requirements</h5>
                                            <div className="applicant-print-grid">
                                                {snapshotData.ungrouped.map((req) => {
                                                    const doc = getDocument(req.requirement_code);
                                                    const resp = getResponse(req.requirement_code);
                                                    return (
                                                        <div className="applicant-print-item applicant-print-item-wide" key={req.requirement_code}>
                                                            <span>{req.label}{req.required ? " *" : ""}</span>
                                                            <strong>
                                                                {req.requirement_type === "document_upload" ? (
                                                                    doc ? (
                                                                        <button type="button" className="applicant-document-link" onClick={() => previewDocumentFile(doc, app.id)}>
                                                                            {doc.file_name || "View Document"}
                                                                        </button>
                                                                    ) : (
                                                                        "Not submitted"
                                                                    )
                                                                ) : (
                                                                    resp ? resp.response_value : "Not submitted"
                                                                )}
                                                                {renderReviewBadge(doc?.review_status || resp?.review_status)}
                                                            </strong>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    {allRequirements.length === 0 && (
                                        <p className="text-muted">No requirements found for this application.</p>
                                    )}
                                </div>
                            );
                        }

                        // ── LEGACY APPLICATION SUMMARY (fallback) ──
                        const parseArrayField = (value) => {
                            if (Array.isArray(value)) return value;
                            if (!value) return [];
                            if (typeof value === "string") {
                                try {
                                    const parsed = JSON.parse(value);
                                    return Array.isArray(parsed) ? parsed : [value];
                                } catch {
                                    return [value];
                                }
                            }
                            return [];
                        };

                        const disabilities = parseArrayField(app?.disability);
                        const languages = parseArrayField(app?.languages);
                        const otherSkills = parseArrayField(app?.other_skills);
                        const profileEmploymentHistory = app?.alumni?.AlumniProfile?.EmploymentHistories || [];
                        const isMeaningfulEmploymentValue = (value) => {
                            const normalized = String(value || "").trim().toLowerCase();
                            return normalized && normalized !== "n/a" && normalized !== "none";
                        };
                        const fallbackEmploymentHistory =
                            isMeaningfulEmploymentValue(app?.company) || isMeaningfulEmploymentValue(app?.position)
                                ? [
                                    {
                                        id: "application-work-history",
                                        company_name: isMeaningfulEmploymentValue(app?.company) ? app.company : "Not specified",
                                        position: isMeaningfulEmploymentValue(app?.position) ? app.position : "Not specified",
                                        start_year: app?.employment_period || null,
                                        end_year: app?.work_status || null,
                                        employment_type: null
                                    }
                                ]
                                : [];
                        const employmentHistoryRows =
                            profileEmploymentHistory.length > 0 ? profileEmploymentHistory : fallbackEmploymentHistory;

                        return (
                            <div className="applicant-print-sheet" ref={applicantPrintRef}>
                                <div className="applicant-print-header">
                                    <div
                                        className={`resume-avatar ${app?.alumni?.AlumniProfile?.avatar_url ? "with-photo" : ""}`}
                                        style={
                                            app?.alumni?.AlumniProfile?.avatar_url
                                                ? { backgroundImage: `url(${app.alumni.AlumniProfile.avatar_url})` }
                                                : undefined
                                        }
                                        aria-label="Applicant avatar"
                                    >
                                        {!app?.alumni?.AlumniProfile?.avatar_url &&
                                            (app?.alumni?.name?.[0]?.toUpperCase() || "A")}
                                    </div>
                                    <div className="applicant-print-identity">
                                        <h3>{app?.alumni?.name || app?.full_name || "Unknown Applicant"}</h3>
                                        <p>{app?.Job?.title || "Position Not Available"}</p>
                                        <span>Application Summary</span>
                                    </div>
                                </div>

                                <div className="applicant-print-section">
                                    <h5>Position Information</h5>
                                    <div className="applicant-print-grid">
                                        <div className="applicant-print-item"><span>Position Applied For</span><strong>{app?.position_applied_for || app?.Job?.title || "N/A"}</strong></div>
                                        <div className="applicant-print-item"><span>Department / Office</span><strong>{app?.department_office || "N/A"}</strong></div>
                                        <div className="applicant-print-item"><span>Employment Type</span><strong>{app?.employment_type || app?.preferred_work_type || "N/A"}</strong></div>
                                        <div className="applicant-print-item"><span>Preferred Work Location</span><strong>{app?.preferred_work_location || app?.preferred_location_detail || "N/A"}</strong></div>
                                        <div className="applicant-print-item"><span>Expected Salary</span><strong>{app?.expected_salary || "N/A"}</strong></div>
                                        <div className="applicant-print-item"><span>Start Date</span><strong>{app?.start_date || "N/A"}</strong></div>
                                    </div>
                                </div>

                                <div className="applicant-print-section">
                                    <h5>Personal Information</h5>
                                    <div className="applicant-print-grid">
                                        <div className="applicant-print-item"><span>Full Name</span><strong>{app?.alumni?.name || app?.full_name || "N/A"}</strong></div>
                                        <div className="applicant-print-item"><span>Email</span><strong>{app?.alumni?.email || app?.email || "N/A"}</strong></div>
                                        <div className="applicant-print-item"><span>Date of Birth</span><strong>{app?.dob || "N/A"}</strong></div>
                                        <div className="applicant-print-item"><span>Place of Birth</span><strong>{app?.place_of_birth || "N/A"}</strong></div>
                                        <div className="applicant-print-item"><span>Gender</span><strong>{app?.gender || "N/A"}</strong></div>
                                        <div className="applicant-print-item"><span>Civil Status</span><strong>{app?.civil_status || "N/A"}</strong></div>
                                        <div className="applicant-print-item"><span>Nationality</span><strong>{app?.nationality || "N/A"}</strong></div>
                                        <div className="applicant-print-item"><span>Contact Number</span><strong>{app?.contact_number || app?.reference_contact || "N/A"}</strong></div>
                                        <div className="applicant-print-item applicant-print-item-wide"><span>Address</span><strong>{app?.address || "N/A"}</strong></div>
                                        <div className="applicant-print-item applicant-print-item-wide"><span>Disability</span><strong>{disabilities.length ? disabilities.join(", ") : "N/A"}</strong></div>
                                        {app?.disability_other && <div className="applicant-print-item applicant-print-item-wide"><span>Other Disability</span><strong>{app.disability_other}</strong></div>}
                                    </div>
                                </div>

                                <div className="applicant-print-section">
                                    <h5>Professional Summary</h5>
                                    <div className="applicant-print-grid">
                                        <div className="applicant-print-item applicant-print-item-wide"><span>Summary</span><strong>{app?.professional_summary || "N/A"}</strong></div>
                                    </div>
                                </div>

                                <div className="applicant-print-section">
                                    <h5>Eligibility</h5>
                                    <div className="applicant-print-grid">
                                        <div className="applicant-print-item"><span>Civil Service Eligibility</span><strong>{app?.civil_service_eligibility || "N/A"}</strong></div>
                                        <div className="applicant-print-item"><span>Rating</span><strong>{app?.rating || "N/A"}</strong></div>
                                        <div className="applicant-print-item"><span>License Number</span><strong>{app?.license_number || "N/A"}</strong></div>
                                        <div className="applicant-print-item"><span>Validity</span><strong>{app?.validity || "N/A"}</strong></div>
                                    </div>
                                </div>

                                <div className="applicant-print-section">
                                    <h5>Employment Information</h5>
                                    <div className="applicant-print-grid">
                                        <div className="applicant-print-item"><span>Current Status</span><strong>{app?.employment_status || "N/A"}</strong></div>
                                        <div className="applicant-print-item applicant-print-item-wide"><span>Employment Category / Type</span><strong>{app?.employment_type_detail || "N/A"}</strong></div>
                                    </div>
                                </div>

                                <div className="applicant-print-section">
                                    <h5>Job Preferences</h5>
                                    <div className="applicant-print-grid">
                                        <div className="applicant-print-item"><span>Preferred Occupation / Position</span><strong>{app?.preferred_occupation || "N/A"}</strong></div>
                                        <div className="applicant-print-item"><span>Preferred Work Type</span><strong>{app?.preferred_work_type || "N/A"}</strong></div>
                                        <div className="applicant-print-item"><span>Preferred Work Location</span><strong>{app?.preferred_location_type || "N/A"}</strong></div>
                                        <div className="applicant-print-item applicant-print-item-wide"><span>Preferred City / Municipality</span><strong>{app?.preferred_location_detail || "N/A"}</strong></div>
                                    </div>
                                </div>

                                <div className="applicant-print-section">
                                    <h5>Education</h5>
                                    <div className="applicant-print-grid">
                                        <div className="applicant-print-item"><span>School</span><strong>{app?.school || "N/A"}</strong></div>
                                        <div className="applicant-print-item"><span>Degree</span><strong>{app?.degree || app?.alumni?.AlumniProfile?.course || "N/A"}</strong></div>
                                        <div className="applicant-print-item"><span>Years Attended</span><strong>{app?.years_attended || "N/A"}</strong></div>
                                        <div className="applicant-print-item"><span>Year Graduated</span><strong>{app?.education || "N/A"}</strong></div>
                                    </div>
                                </div>

                                <div className="applicant-print-section">
                                    <h5>Work Experience</h5>
                                    <div className="applicant-print-grid">
                                        <div className="applicant-print-item"><span>Company</span><strong>{app?.company || "N/A"}</strong></div>
                                        <div className="applicant-print-item"><span>Position</span><strong>{app?.position || "N/A"}</strong></div>
                                        <div className="applicant-print-item"><span>Period</span><strong>{app?.employment_period || "N/A"}</strong></div>
                                        <div className="applicant-print-item"><span>Status</span><strong>{app?.work_status || "N/A"}</strong></div>
                                        <div className="applicant-print-item applicant-print-item-wide"><span>Responsibilities</span><strong>{app?.responsibilities || "N/A"}</strong></div>
                                        <div className="applicant-print-item applicant-print-item-wide"><span>Achievements</span><strong>{app?.achievements || "N/A"}</strong></div>
                                        <div className="applicant-print-item applicant-print-item-wide"><span>Reason for Leaving</span><strong>{app?.reason_for_leaving || "N/A"}</strong></div>
                                    </div>
                                </div>

                                <div className="applicant-print-section">
                                    <h5>Skills and Competencies</h5>
                                    <div className="applicant-print-grid">
                                        <div className="applicant-print-item applicant-print-item-wide"><span>Primary Skills</span><strong>{app?.skills || "N/A"}</strong></div>
                                        <div className="applicant-print-item applicant-print-item-wide"><span>Soft Skills</span><strong>{app?.soft_skills || "N/A"}</strong></div>
                                        <div className="applicant-print-item applicant-print-item-wide"><span>Certifications</span><strong>{app?.certifications || "N/A"}</strong></div>
                                        <div className="applicant-print-item applicant-print-item-wide"><span>Other Skills</span><strong>{otherSkills.length ? otherSkills.join(", ") : "N/A"}</strong></div>
                                        {app?.other_skills_other && <div className="applicant-print-item applicant-print-item-wide"><span>Other Skill Details</span><strong>{app.other_skills_other}</strong></div>}
                                        <div className="applicant-print-item applicant-print-item-wide"><span>Languages</span><strong>{languages.length ? languages.join(", ") : "N/A"}</strong></div>
                                    </div>
                                </div>

                                <div className="applicant-print-section">
                                    <h5>Leadership Experience</h5>
                                    <div className="applicant-print-grid">
                                        <div className="applicant-print-item"><span>Role</span><strong>{app?.leadership_role || "N/A"}</strong></div>
                                        <div className="applicant-print-item"><span>People Managed</span><strong>{app?.people_managed || "N/A"}</strong></div>
                                        <div className="applicant-print-item applicant-print-item-wide"><span>Key Achievements</span><strong>{app?.leadership_achievements || "N/A"}</strong></div>
                                    </div>
                                </div>

                                <div className="applicant-print-section">
                                    <h5>Training / Seminar</h5>
                                    <div className="applicant-print-grid">
                                        <div className="applicant-print-item"><span>Title</span><strong>{app?.training_title || "N/A"}</strong></div>
                                        <div className="applicant-print-item"><span>Organization</span><strong>{app?.training_organization || "N/A"}</strong></div>
                                        <div className="applicant-print-item"><span>Duration</span><strong>{app?.training_duration || "N/A"}</strong></div>
                                        <div className="applicant-print-item"><span>Date</span><strong>{app?.training_date || "N/A"}</strong></div>
                                    </div>
                                </div>

                                <div className="applicant-print-section">
                                    <h5>Background Information</h5>
                                    <div className="applicant-print-grid">
                                        <div className="applicant-print-item"><span>Convicted of crime</span><strong>{app?.convicted_of_crime || "N/A"}</strong></div>
                                        <div className="applicant-print-item"><span>Dismissed from service</span><strong>{app?.dismissed_from_service || "N/A"}</strong></div>
                                        <div className="applicant-print-item"><span>Currently employed</span><strong>{app?.currently_employed || "N/A"}</strong></div>
                                        <div className="applicant-print-item"><span>Can work overtime</span><strong>{app?.can_work_overtime || "N/A"}</strong></div>
                                    </div>
                                </div>

                                <div className="applicant-print-section">
                                    <h5>Additional Information</h5>
                                    <div className="applicant-print-grid">
                                        <div className="applicant-print-item applicant-print-item-wide"><span>Why do you want to join this organization?</span><strong>{app?.why_join || "N/A"}</strong></div>
                                        <div className="applicant-print-item applicant-print-item-wide"><span>What makes you a good fit for the position?</span><strong>{app?.good_fit || "N/A"}</strong></div>
                                        <div className="applicant-print-item applicant-print-item-wide"><span>Career Goals</span><strong>{app?.career_goals || "N/A"}</strong></div>
                                    </div>
                                </div>

                                <div className="applicant-print-section">
                                    <h5>Declaration</h5>
                                    <div className="applicant-print-grid">
                                        <div className="applicant-print-item applicant-print-item-wide"><span>Information provided is true and correct</span><strong>{app?.declaration_confirmed || "N/A"}</strong></div>
                                    </div>
                                </div>

                                <div className="applicant-print-section">
                                    <h5>Alumni Profile History</h5>
                                    {employmentHistoryRows.length === 0 && (
                                        <p className="applicant-history-empty">No employment history added yet.</p>
                                    )}
                                    {employmentHistoryRows.map((item) => (
                                        <div key={item.id} className="applicant-history-row">
                                            <strong>{item.position}</strong> at {item.company_name}
                                            <span>
                                                {item.start_year || "N/A"}
                                                {item.end_year ? ` - ${item.end_year}` : ""}
                                                {item.employment_type ? ` | ${item.employment_type}` : ""}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        );
                    })()}
                </Modal.Body>
                <Modal.Footer className="applicant-modal-footer">
                    <Button variant="outline-dark" onClick={handlePrintApplication} disabled={!selectedApplication}>
                        Print Application
                    </Button>
                    <div className="applicant-modal-actions">
                        <Button variant="success" onClick={openVerifyModal} disabled={reviewing}>
                            Verify
                        </Button>
                        <Button variant="outline-danger" onClick={() => reviewApplication("not_verified")} disabled={reviewing}>
                            Not Verify
                        </Button>
                    </div>
                </Modal.Footer>
            </Modal>

            <Modal
                show={Boolean(previewDocument) || Boolean(previewDocumentError)}
                onHide={closeDocumentPreview}
                centered
                size="xl"
                backdrop="static"
            >
                <Modal.Header closeButton>
                    <Modal.Title>{previewDocument?.fileName || "Document Preview"}</Modal.Title>
                </Modal.Header>
                <Modal.Body style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 420, background: "#f8fafc", padding: 16 }}>
                    {previewDocumentLoading ? (
                        <div style={{ textAlign: "center", width: "100%" }}>
                            <div className="spinner-border text-primary" role="status" aria-label="Loading document" />
                            <p style={{ marginTop: 12, marginBottom: 0 }}>Loading preview...</p>
                        </div>
                    ) : previewDocumentError ? (
                        <div style={{ width: "100%", maxWidth: 520, textAlign: "center" }}>
                            <div className="alert alert-danger mb-0" role="alert">{previewDocumentError}</div>
                        </div>
                    ) : previewDocument ? (
                        previewDocument.type === "image" ? (
                            <img
                                src={previewDocument.url}
                                alt={previewDocument.fileName}
                                onError={() => setPreviewDocumentError("The uploaded image could not be displayed. Try downloading the file.")}
                                style={{ maxWidth: "100%", maxHeight: "72vh", objectFit: "contain", borderRadius: 12, boxShadow: "0 8px 18px rgba(15, 23, 42, 0.12)" }}
                            />
                        ) : previewDocument.type === "pdf" ? (
                            <iframe
                                title={previewDocument.fileName}
                                src={previewDocument.url}
                                style={{ width: "100%", minHeight: 620, border: 0, borderRadius: 12, background: "#fff" }}
                            />
                        ) : (
                            <div style={{ textAlign: "center", width: "100%" }}>
                                <p style={{ marginBottom: 12 }}>This file type cannot be displayed inline.</p>
                                <a href={previewDocument.url} target="_blank" rel="noopener noreferrer" className="btn btn-primary">
                                    Open file in new tab
                                </a>
                            </div>
                        )
                    ) : null}
                </Modal.Body>
                <Modal.Footer>
                    <Button variant="secondary" onClick={closeDocumentPreview}>Close</Button>
                    {previewDocument?.url && (
                        <Button variant="primary" onClick={downloadPreviewDocument}>Download</Button>
                    )}
                </Modal.Footer>
            </Modal>

            <Modal show={verifyModalOpen} onHide={() => !reviewing && setVerifyModalOpen(false)} centered>
                <Modal.Header closeButton>
                    <Modal.Title>Verify Applicant</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <Form>
                        <Form.Group className="mb-3">
                            <Form.Label>Venue</Form.Label>
                            <Form.Control name="venue" value={verifyForm.venue} onChange={handleVerifyFormChange} required />
                        </Form.Group>
                        <Form.Group className="mb-3">
                            <Form.Label>Place / Address</Form.Label>
                            <Form.Control name="place" value={verifyForm.place} onChange={handleVerifyFormChange} required />
                        </Form.Group>
                        <Form.Group className="mb-3">
                            <Form.Label>Interview Date</Form.Label>
                            <Form.Control type="date" name="date" value={verifyForm.date} onChange={handleVerifyFormChange} required />
                        </Form.Group>
                        <Form.Group className="mb-3">
                            <Form.Label>Interview Time</Form.Label>
                            <Form.Control type="time" name="time" value={verifyForm.time} onChange={handleVerifyFormChange} required />
                        </Form.Group>
                        <Form.Group>
                            <Form.Label>Contact Information (Email or Phone)</Form.Label>
                            <Form.Control name="contact_info" value={verifyForm.contact_info} onChange={handleVerifyFormChange} required />
                        </Form.Group>
                        <Form.Group className="mt-3">
                            <Form.Label>What to Bring</Form.Label>
                            <Form.Control
                                as="textarea"
                                rows={3}
                                name="what_to_bring"
                                value={verifyForm.what_to_bring}
                                onChange={handleVerifyFormChange}
                                placeholder="Optional: list documents, IDs, resumes, or materials the applicant should bring."
                            />
                        </Form.Group>
                    </Form>
                </Modal.Body>
                <Modal.Footer className="applicant-modal-footer">
                    <Button variant="outline-secondary" onClick={() => setVerifyModalOpen(false)} disabled={reviewing}>
                        Cancel
                    </Button>
                    <Button
                        variant="success"
                        onClick={() => reviewApplication("verified", verifyForm)}
                        disabled={reviewing || !verifyForm.venue.trim() || !verifyForm.place.trim() || !verifyForm.date || !verifyForm.time || !verifyForm.contact_info.trim()}
                    >
                        Done
                    </Button>
                </Modal.Footer>
            </Modal>
        </AdminShell >
    );
}
