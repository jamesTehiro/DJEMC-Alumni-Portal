import ApplicantDocumentWorkspace, { ApplicantResumePrintButton } from "../components/ApplicantDocumentWorkspace";
import ApplicantResumePreview from "../components/ApplicantResumePreview";
import { isResumeRequirement, getApplicantDocumentFilename, getApplicantResumeDocument, getApplicantResumeFileUrl } from "../utils/applicantResume";
import { canDecideApplication, saveApplicationDecision, updateActiveApplications } from "../utils/applicationDecision";
import { APPROVED_LABEL, applicationStatusLabel } from "../utils/applicationStatus";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Modal } from "react-bootstrap";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { BsTrash } from "react-icons/bs";
import { api, fetchFile, API_BASE_URL } from "../services/api";
import useRenderDebug from "../hooks/useRenderDebug";
import useStrictSafeEffect from "../hooks/useStrictSafeEffect";
import { useUndoDelete } from "../hooks/useUndoDelete";
import { getEmploymentTypeLabel } from "../utils/employmentTypes";
import AdminShell from "../components/AdminShell";
import InterviewDetailsModal, { EMPTY_INTERVIEW_DETAILS } from "../components/InterviewDetailsModal";
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
    const decisionBusy = useRef(false);
    const [decisionSaving, setDecisionSaving] = useState(false);
    const [searchParams, setSearchParams] = useSearchParams();
    const selectedJobId = searchParams.get("jobId");
    const [jobSearch, setJobSearch] = useState("");
    const [jobsLoading, setJobsLoading] = useState(true);
    const [applicationsLoading, setApplicationsLoading] = useState(true);
    const [recruitmentBusy, setRecruitmentBusy] = useState(null);
    const [editingInterviewJob, setEditingInterviewJob] = useState(null);
    const [interviewDraft, setInterviewDraft] = useState({ ...EMPTY_INTERVIEW_DETAILS });
    const [interviewLoading, setInterviewLoading] = useState(false);
    const [interviewSaving, setInterviewSaving] = useState(false);
    const [interviewLoadError, setInterviewLoadError] = useState("");
    const [interviewSaveError, setInterviewSaveError] = useState("");
    const [interviewConfigured, setInterviewConfigured] = useState(false);
    const interviewDetailsRequestRef = useRef(0);
    const interviewSaveInProgressRef = useRef(false);
    const [employers, setEmployers] = useState([]);
    const [jobs, setJobs] = useState([]);
    const [applications, setApplications] = useState([]);
    const [message, setMessage] = useState("");
    const [error, setError] = useState("");
    const [selectedEmployer, setSelectedEmployer] = useState(null);
    const [selectedApplication, setSelectedApplication] = useState(null);
    const [inlineResume, setInlineResume] = useState(null);
    useEffect(() => { setInlineResume(null); }, [selectedApplication?.id]);
    const [previewDocument, setPreviewDocument] = useState(null);
    const [previewDocumentError, setPreviewDocumentError] = useState("");
    const [previewDocumentLoading, setPreviewDocumentLoading] = useState(false);
    const documentPreviewUrlRef = useRef(null);
    const documentPreviewRequestRef = useRef(0);
    const [reviewing, setReviewing] = useState(false);
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
        setJobsLoading(true);
        try {
            const data = await api.get("/admin/employer/jobs", true);
            setJobs(Array.isArray(data) ? data : []);
        } catch (err) {
            setError(err.message);
        } finally {
            setJobsLoading(false);
        }
    };

    const loadApplications = async () => {
        setApplicationsLoading(true);
        try {
            const data = await api.get("/admin/employer/applications", true);
            setApplications(Array.isArray(data) ? data : []);
        } catch (err) {
            setError(err.message);
        } finally {
            setApplicationsLoading(false);
        }
    };

    const selectJob = (job) => {
        setMessage("");
        setError("");
        setSelectedApplication(null);
        setSearchParams({ jobId: String(job.id) });
    };

    const openJobInterviewDetails = async (job) => {
        if (!job?.id || interviewSaveInProgressRef.current) return;
        const requestId = ++interviewDetailsRequestRef.current;
        setMessage("");
        setError("");
        setEditingInterviewJob(job);
        setInterviewDraft({ ...EMPTY_INTERVIEW_DETAILS });
        setInterviewConfigured(false);
        setInterviewLoading(true);
        setInterviewLoadError("");
        setInterviewSaveError("");
        try {
            const result = await api.get(`/jobs/${job.id}/interview-details`, true);
            if (requestId !== interviewDetailsRequestRef.current) return;
            if (String(result?.job?.id) !== String(job.id)) throw new Error("The interview details response did not match the selected job. Please retry.");
            setEditingInterviewJob({ ...job, ...result.job });
            setInterviewDraft({ ...EMPTY_INTERVIEW_DETAILS, ...(result.interview_details || {}) });
            setInterviewConfigured(Boolean(result.configured));
        } catch (err) {
            if (requestId === interviewDetailsRequestRef.current) setInterviewLoadError(err.message || "Unable to load interview details.");
        } finally {
            if (requestId === interviewDetailsRequestRef.current) setInterviewLoading(false);
        }
    };

    const closeJobInterviewDetails = () => {
        if (interviewSaveInProgressRef.current) return;
        interviewDetailsRequestRef.current += 1;
        setEditingInterviewJob(null);
        setInterviewLoading(false);
    };

    const saveJobInterviewDetails = async () => {
        if (!editingInterviewJob?.id || interviewSaveInProgressRef.current || interviewLoading || interviewLoadError) return;
        const jobId = editingInterviewJob.id;
        interviewSaveInProgressRef.current = true;
        setInterviewSaving(true);
        setInterviewSaveError("");
        setError("");
        try {
            const result = await api.put(`/jobs/${jobId}/interview-details`, { interview_details: interviewDraft }, true);
            if (String(result?.job?.id) !== String(jobId) || result.configured !== true) throw new Error("The saved interview details could not be confirmed. Reopen the job details before retrying.");
            const savedDetails = { ...EMPTY_INTERVIEW_DETAILS, ...result.interview_details };
            const columns = {
                interview_venue: savedDetails.venue,
                interview_place: savedDetails.place,
                interview_date: savedDetails.date,
                interview_time: savedDetails.time,
                interview_contact_info: savedDetails.contact_info,
                interview_what_to_bring: savedDetails.what_to_bring
            };
            setJobs((current) => current.map((job) => Number(job.id) === Number(jobId) ? { ...job, ...result.job, ...columns } : job));
            setInterviewDraft(savedDetails);
            setInterviewConfigured(true);
            setMessage(result.msg || "Interview details updated successfully.");
            interviewDetailsRequestRef.current += 1;
            setEditingInterviewJob(null);
        } catch (err) {
            setInterviewSaveError(err.message || "Unable to save interview details.");
        } finally {
            interviewSaveInProgressRef.current = false;
            setInterviewSaving(false);
        }
    };

    const changeRecruitment = async (job) => {
        if (recruitmentBusy !== null) return;
        const closed = job.recruitment_status === "closed";
        if (!window.confirm(`${closed ? "Resume" : "Stop"} recruitment for ${job.title || "this job"}?`)) return;
        setRecruitmentBusy(job.id);
        setError("");
        try {
            const result = await api.post(`/admin/employer/jobs/${job.id}/${closed ? "reactivate-recruitment" : "stop-recruitment"}`, {}, true);
            setMessage(result.msg || "Recruitment status updated.");
            await loadJobs();
            await loadApplications();
        } catch (err) {
            setError(err.message);
        } finally {
            setRecruitmentBusy(null);
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

    const decideApplication = async (status) => {
        if (!canDecideApplication(selectedApplication, decisionBusy.current)) return;
        decisionBusy.current = true;
        setDecisionSaving(true);
        setError("");
        try {
            const result = await saveApplicationDecision(selectedApplication, status, api, message => window.confirm(message));
            if (!result) return;
            const update = records => updateActiveApplications(records, selectedApplication.id, status);
            setApplications(update);

            setSelectedApplication(previous => previous?.id === selectedApplication.id
                ? { ...previous, status: result.application?.status || status } : previous);
            setMessage(result.msg);
        } catch (err) { setError(err.message || "Unable to update application."); }
        finally { decisionBusy.current = false; setDecisionSaving(false); }
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

    const applicantName = (application) => application?.alumni?.name || application?.full_name || application?.name || "";
    const selectedJob = jobs.find((job) => String(job.id) === selectedJobId);
    const jobApplications = selectedJob
        ? applications.filter((application) => String(application.job_id ?? application.Job?.id) === String(selectedJob.id))
        : [];
    const orderedJobs = [...jobs].filter((job) => !jobSearch.trim() || [job.title, job.location].some((value) => String(value || "").toLowerCase().includes(jobSearch.trim().toLowerCase())))
        .sort((a, b) => String(a.title || "").localeCompare(String(b.title || ""), undefined, { sensitivity: "base" }) || Number(a.id) - Number(b.id));
    const orderedApplications = [...jobApplications].sort((a, b) => {
        const left = applicantName(a).trim();
        const right = applicantName(b).trim();
        if (!left) return right ? 1 : 0;
        if (!right) return -1;
        return left.localeCompare(right, undefined, { sensitivity: "base" });
    });
    const waitingApplications = orderedApplications.filter((application) =>
        ["pending", "pending_review", "submitted"].includes(String(application.status || "pending").toLowerCase())
    );
    const interviewApplications = orderedApplications.filter((application) =>
        ["verified", "ready_for_interview", "approved"].includes(String(application.status || "").toLowerCase())
    );
    const otherApplications = orderedApplications.filter((application) =>
        !["pending", "pending_review", "submitted", "verified", "ready_for_interview", "approved"].includes(String(application.status || "pending").toLowerCase())
    );
    const renderApplicantSection = (title, records, emptyText, tone) => (
        <section className={`admin-applicant-status-section ${tone}`} aria-label={title}>
            <header>
                <h3>{title}</h3>
                <span>{records.length}</span>
            </header>
            {records.length ? (
                <div className="admin-applicant-list">
                    {records.map((applicant) => {
                        const status = String(applicant.status || "pending").replaceAll("_", " ").toUpperCase();
                        return (
                            <div key={applicant.id} className="job-item-min">
                                <div className="admin-applicant-row-copy">
                                    <strong>{applicantName(applicant) || "Unknown Applicant"}</strong>
                                    <p>{applicant.Job?.title || "Job"} | {applicant.createdAt ? new Date(applicant.createdAt).toLocaleDateString() : "N/A"}</p>
                                    <p>{applicant.alumni?.email || applicant.email || "N/A"}</p>
                                </div>
                                <div className="admin-applicant-row-actions">
                            <span className={`emp-status-badge ${tone === "waiting" ? "pending" : tone === "ready" ? "approved" : "rejected"}`}>
                                {tone === "waiting" ? "WAITING FOR APPROVAL" : tone === "ready" ? APPROVED_LABEL : status}
                            </span>
                                    <Button variant="outline-success" size="sm" onClick={() => openApplicationDetails(applicant)}>
                                        View Application
                                    </Button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            ) : <p className="empty-jobs">{emptyText}</p>}
        </section>
    );

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
        if (mimeTypes.some((type) => type.startsWith("image/")) || /\.(png|jpe?g|webp|gif|bmp|avif)$/.test(fileName)) return "image";
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
        const requestId = ++documentPreviewRequestRef.current;
        if (documentPreviewUrlRef.current) URL.revokeObjectURL(documentPreviewUrlRef.current);
        documentPreviewUrlRef.current = null;
        setPreviewDocument(null);
        if (!applicationId || (!documentEntry?.id && !documentEntry?.isLegacyResume && !documentEntry?.isLegacyDocument)) {
            setPreviewDocumentError("This application document is missing its file record.");
            setPreviewDocumentLoading(false);
            return;
        }

        setPreviewDocumentLoading(true);
        setPreviewDocumentError("");

        try {
            const fileUrl = getApplicantResumeFileUrl(applicationId, documentEntry);
            const blob = await fetchFile(fileUrl, true);
            if (requestId !== documentPreviewRequestRef.current) return;
            if (!blob.size || ["text/html", "application/json"].includes(blob.type)) {
                throw new Error("The server did not return the uploaded document. Please try again or contact support.");
            }
            const previewType = getPreviewType(documentEntry, blob);
            const objectUrl = URL.createObjectURL(blob);
            documentPreviewUrlRef.current = objectUrl;
            setPreviewDocument({
                url: objectUrl,
                type: previewType,
                fileName: getApplicantDocumentFilename(documentEntry)
            });
        } catch (error) {
            if (requestId === documentPreviewRequestRef.current) {
                setPreviewDocumentError(error.message || "The document could not be previewed.");
                setPreviewDocument(null);
            }
        } finally {
            if (requestId === documentPreviewRequestRef.current) setPreviewDocumentLoading(false);
        }
    };

    const downloadApplicationDocument = async (documentEntry, applicationId) => {
        if (!applicationId || (!documentEntry?.id && !documentEntry?.isLegacyResume && !documentEntry?.isLegacyDocument)) {
            setError("This application document is missing its file record.");
            return;
        }

        try {
            const fileUrl = getApplicantResumeFileUrl(applicationId, documentEntry);
            const blob = await fetchFile(fileUrl, true);
            if (!blob.size || ["text/html", "application/json"].includes(blob.type)) {
                throw new Error("The server did not return the uploaded document.");
            }
            const objectUrl = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = objectUrl;
            link.download = String(getApplicantDocumentFilename(documentEntry)).replace(/[\\/:*?"<>|\r\n]/g, "_");
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
        } catch (downloadError) {
            setError(downloadError.message || "The document could not be downloaded.");
        }
    };

    const closeDocumentPreview = () => {
        documentPreviewRequestRef.current += 1;
        if (documentPreviewUrlRef.current) URL.revokeObjectURL(documentPreviewUrlRef.current);
        documentPreviewUrlRef.current = null;
        setPreviewDocument(null);
        setPreviewDocumentError("");
        setPreviewDocumentLoading(false);
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

                    <section className="metric-grid mobile-scroll-cards">
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
            title={selectedJobId ? "Job-Specific Applicants" : "Manage Posted Jobs"}
            subtitle={selectedJobId ? `Review applicants for ${selectedJob?.title || "the selected job"}.` : "Select a job to manage its applicants and interview details."}
            eyebrow={selectedJobId ? "Applicant Management" : "Job Management"}
            onLogout={handleLogout}
        >
            <div className="admin-main-content">
                {message && <p className="notice success">{message}</p>}
                {error && <p className="notice error">{error}</p>}

                <section className="content-grid admin-applicant-management-layout">
                    <div className="queue-panel employer-manage-jobs-page">
                        {!selectedJobId ? <>
                            <div className="panel-header"><h2>List of Jobs</h2><span>{jobs.length} total</span></div>
                            <input className="admin-posted-jobs-search" type="search" placeholder="Search jobs by title or location" aria-label="Search posted jobs" value={jobSearch} onChange={(event) => setJobSearch(event.target.value)} />
                            <div className="admin-posted-jobs-list">
                                {jobsLoading ? <p role="status">Loading jobs…</p> : orderedJobs.length ? orderedJobs.map((job) => <div className="emp-list-item" key={job.id}>
                                    <div className="emp-list-item-left"><strong>{job.title || "Untitled Job"}</strong><p>{job.location || "Location not specified"}{job.expected_salary ? ` · ${job.expected_salary}` : ""}</p></div>
                                    <div className="emp-list-item-right">
                                        <span className={`emp-status-badge ${job.recruitment_status === "closed" ? "rejected" : "approved"}`}>{job.recruitment_status === "closed" ? "STOPPED" : "ACTIVE"}</span>
                                        <span className="emp-type-tag">{getEmploymentTypeLabel(job.employment_type)}</span>
                                        <button type="button" className="emp-view-btn emp-manage-applicants-btn" onClick={() => selectJob(job)}>Manage Applicants</button>
                                        <button type="button" className={job.recruitment_status === "closed" ? "emp-reactivate-btn" : "emp-stop-btn"} disabled={recruitmentBusy !== null} onClick={() => changeRecruitment(job)}>{recruitmentBusy === job.id ? "Updating…" : job.recruitment_status === "closed" ? "Resume Recruitment" : "Stop Recruitment"}</button>
                                        <button type="button" className="emp-delete-btn" aria-label={`Delete ${job.title || "job"}`} title="Delete Job" onClick={() => handleDeleteJob(job)}><BsTrash className="emp-delete-icon" aria-hidden="true" /></button>
                                    </div>
                                </div>) : <p className="empty-jobs">{jobSearch ? "No jobs match your search." : "No posted jobs yet."}</p>}
                            </div>
                        </> : <>
                        <Button variant="outline-success" size="sm" className="mb-3" onClick={() => { setSearchParams({}); setMessage(""); setError(""); }}>Back to Jobs</Button>
                        {jobsLoading || applicationsLoading ? <p role="status">Loading job applicants…</p> : !selectedJob ? <p role="alert">This job is unavailable. Return to the job list to select another job.</p> : <>
                        <div className="panel-header">
                            <h2>Applicants for: {selectedJob.title}</h2>
                            <span>Applications for this job only.</span>
                        </div>
                        <p className="admin-applicant-total">{jobApplications.length} current applications</p>
                        {renderApplicantSection("Waiting for Approval", waitingApplications, "No applicants waiting for approval.", "waiting")}
                        {renderApplicantSection("Approved Applicants", interviewApplications, "No approved applicants.", "ready")}
                        {otherApplications.length > 0 && renderApplicantSection("Other Application Statuses", otherApplications, "No other applications.", "other")}
                        </>}
                        </>}
                    </div>

                </section>
            </div>
            <InterviewDetailsModal
                show={!!editingInterviewJob}
                onHide={closeJobInterviewDetails}
                mode="edit"
                jobTitle={editingInterviewJob?.title}
                values={interviewDraft}
                configured={interviewConfigured}
                onChange={(field, value) => setInterviewDraft((previous) => ({ ...previous, [field]: value }))}
                onSave={saveJobInterviewDetails}
                loading={interviewLoading}
                saving={interviewSaving}
                loadError={interviewLoadError}
                saveError={interviewSaveError}
                onRetry={() => openJobInterviewDetails(editingInterviewJob)}
            />
            <Modal
                show={!!selectedApplication}
                onHide={() => {
                    setInlineResume(null);
                    setSelectedApplication(null);
                }}
                centered
                size="lg"
                scrollable
                dialogClassName="resume-dialog applicant-details-dialog"
                contentClassName="resume-content applicant-details-content"
                backdropClassName="resume-backdrop"
            >
                <Modal.Header closeButton>
                    <Modal.Title>Applicant Details</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    {selectedApplication && <ApplicantDocumentWorkspace key={selectedApplication.id} application={selectedApplication} onDownload={downloadApplicationDocument} onView={previewDocumentFile} />}
                    <details className="applicant-extra-details">
                        <summary>Application information</summary>
                        <Button variant="link" size="sm" onClick={handlePrintApplication}>Print Application Summary</Button>

                    {getApplicantResumeDocument(selectedApplication)?.isLegacyResume && (() => {
                        const resume = getApplicantResumeDocument(selectedApplication);
                        return <section className="applicant-legacy-resume" aria-label="Submitted resume">
                            <h5>Resume / CV</h5>
                            <span className="applicant-document-filename" title={getApplicantDocumentFilename(resume)}>{getApplicantDocumentFilename(resume)}</span>
                            <div className="applicant-document-actions">
                                <button type="button" className="emp-view-btn" onClick={() => previewDocumentFile(resume, selectedApplication.id)}>View</button>
                                <button type="button" className="applicant-document-download" onClick={() => downloadApplicationDocument(resume, selectedApplication.id)}>Download</button>
                                <button type="button" className="emp-view-btn" onClick={() => setInlineResume({ applicationId: selectedApplication.id, document: resume })}>Preview Resume</button>
                            </div>
                        </section>;
                    })()}

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
                                                                        <div className="applicant-document-actions">
                                                                            <button type="button" className="emp-view-btn" onClick={() => previewDocumentFile(doc, app.id)} style={{ padding: "4px 8px", minWidth: 0 }}>View</button>
                                                                            <button type="button" className="applicant-document-download" onClick={() => downloadApplicationDocument(doc, app.id)}>Download</button>
                                                                            {isResumeRequirement(req, doc) && <button type="button" className="emp-view-btn" onClick={() => setInlineResume({ applicationId: app.id, document: doc })}>Preview Resume</button>}
                                                                            <span className="applicant-document-filename" title={getApplicantDocumentFilename(doc)}>{getApplicantDocumentFilename(doc)}</span>
                                                                        </div>
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
                                                                        <div className="applicant-document-actions">
                                                                            <button type="button" className="emp-view-btn" onClick={() => previewDocumentFile(doc, app.id)} style={{ padding: "4px 8px", minWidth: 0 }}>View</button>
                                                                            <button type="button" className="applicant-document-download" onClick={() => downloadApplicationDocument(doc, app.id)}>Download</button>
                                                                            {isResumeRequirement(req, doc) && <button type="button" className="emp-view-btn" onClick={() => setInlineResume({ applicationId: app.id, document: doc })}>Preview Resume</button>}
                                                                            <span className="applicant-document-filename" title={getApplicantDocumentFilename(doc)}>{getApplicantDocumentFilename(doc)}</span>
                                                                        </div>
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
                    {inlineResume && Number(inlineResume.applicationId) === Number(selectedApplication?.id) && <ApplicantResumePreview
                        key={String(selectedApplication.id)} applicationId={selectedApplication.id} document={inlineResume.document}
                        onClose={() => setInlineResume(null)}
                        onView={() => previewDocumentFile(inlineResume.document, selectedApplication.id)}
                        onDownload={() => downloadApplicationDocument(inlineResume.document, selectedApplication.id)} />}
                    </details>
                </Modal.Body>
                <Modal.Footer className="applicant-modal-footer">
                    <ApplicantResumePrintButton application={selectedApplication} />
                    <div className="applicant-modal-actions">
                        <span role="status" className="status-pill">{decisionSaving ? "Processing..." : applicationStatusLabel(selectedApplication?.status)}</span>
                        <Button variant="success" onClick={() => decideApplication("verified")} disabled={!canDecideApplication(selectedApplication, decisionSaving)}>Approve</Button>
                        <Button variant="outline-danger" onClick={() => decideApplication("not_verified")} disabled={!canDecideApplication(selectedApplication, decisionSaving)}>Decline</Button>
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

        </AdminShell >
    );
}
