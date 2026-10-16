import ApplicantResumePreview from "../components/ApplicantResumePreview";
import { isResumeRequirement, getApplicantDocumentFilename, getApplicantResumeDocument, getApplicantResumeFileUrl } from "../utils/applicantResume";
import { canDecideApplication, saveApplicationDecision, updateActiveApplications } from "../utils/applicationDecision";
import { APPROVED_LABEL, applicationStatusLabel } from "../utils/applicationStatus";
﻿import React, { useEffect, useMemo, useRef, useState } from "react";
import { Card, Form, Button, Modal, Spinner, Row, Col, Alert } from "react-bootstrap";
import { Link, useNavigate } from "react-router-dom";
import { api, API_BASE_URL, fetchFile } from "../services/api";
import useRenderDebug from "../hooks/useRenderDebug";
import useStrictSafeEffect from "../hooks/useStrictSafeEffect";
import useAdaptivePoll from "../hooks/useAdaptivePoll";
import usePortalDrawer from "../hooks/usePortalDrawer";
import { mergeUniqueById, replaceUniqueById } from "../utils/list";
import { getEmploymentTypeLabel } from "../utils/employmentTypes";
import { FiBell, FiMenu, FiMoreHorizontal, FiX } from "react-icons/fi";
import { FaHome, FaUser, FaEnvelope, FaBriefcase, FaUsers, FaSignOutAlt, FaCalendarAlt, FaUserCheck } from "react-icons/fa";
import EmployerMessagesPage from "./EmployerMessagesPage";
import "./EmployerPage.css";
import styles from "../components/Sidebar.module.css";
import { useUndoDelete } from "../hooks/useUndoDelete";
import { BsTrash } from "react-icons/bs";
import InterviewDetailsModal, { EMPTY_INTERVIEW_DETAILS } from "../components/InterviewDetailsModal";
import JobPostingForm from "../components/jobs/JobPostingForm";
import { createJobPostingForm, jobPostingPayload, validateJobPosting } from "../utils/jobPosting";

const displayValue = (value, fallback = "N/A") => {
    if (Array.isArray(value)) {
        return value.length ? value.join(", ") : fallback;
    }
    return String(value || "").trim() || fallback;
};

const applicationStatusDisplay = (status) => {
    switch (String(status || "pending").toLowerCase()) {
        case "not_verified":
            return { label: applicationStatusLabel(status), className: "rejected", icon: null };
        case "verified":
            return { label: APPROVED_LABEL, className: "approved", icon: <FaUserCheck aria-hidden="true" /> };
        case "rejected":
            return { label: "REJECTED", className: "rejected", icon: null };
        case "pending":
            return { label: "PENDING", className: "pending", icon: null };
        default:
            return {
                label: String(status || "pending").replaceAll("_", " ").toUpperCase(),
                className: "pending",
                icon: null
            };
    }
};

const ApplicationStatusBadge = ({ status, pendingLabel, labelOverride, classNameOverride }) => {
    const display = applicationStatusDisplay(status);
    const label = String(status || "pending").toLowerCase() === "pending" && pendingLabel
        ? pendingLabel
        : labelOverride || display.label;
    return (
        <span className={`emp-status-badge ${classNameOverride || display.className}`}>
            {!labelOverride && display.icon && <span className="emp-status-badge-icon">{display.icon}</span>}
            {label}
        </span>
    );
};

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

const COMMON_REQUIREMENTS = [
    { requirement_code: "resume", label: "Resume / CV", requirement_type: "document_upload" },
    { requirement_code: "cover_letter", label: "Cover Letter", requirement_type: "document_upload" },
    { requirement_code: "tor", label: "Transcript of Records", requirement_type: "document_upload" },
    { requirement_code: "diploma", label: "Diploma", requirement_type: "document_upload" },
    { requirement_code: "certificate_of_employment", label: "Certificate of Employment", requirement_type: "document_upload" },
    { requirement_code: "recommendation_letter", label: "Recommendation Letter", requirement_type: "document_upload" },
    { requirement_code: "valid_govt_id", label: "Valid Government ID", requirement_type: "document_upload" },
    { requirement_code: "nbi_clearance", label: "NBI Clearance", requirement_type: "document_upload" },
    { requirement_code: "medical_certificate", label: "Medical Certificate", requirement_type: "document_upload" },
    { requirement_code: "pds", label: "Personal Data Sheet (PDS)", requirement_type: "document_upload" },
    { requirement_code: "csc_eligibility", label: "CSC Eligibility", requirement_type: "document_upload" },
    { requirement_code: "professional_license", label: "Professional License", requirement_type: "document_upload" },
    { requirement_code: "expected_salary", label: "Expected Salary", requirement_type: "information_field", value_type: "number" },
    { requirement_code: "availability_date", label: "Availability Date", requirement_type: "information_field", value_type: "date" },
    { requirement_code: "preferred_work_location", label: "Preferred Work Location", requirement_type: "information_field", value_type: "text" },
    { requirement_code: "emergency_contact", label: "Emergency Contact", requirement_type: "information_field", value_type: "textarea" }
];

export default function EmployerPage({ hideRecruitmentActions = false }) {
    useRenderDebug("EmployerPage");
    const navigate = useNavigate();
    const decisionBusy = useRef(false);
    const [decisionSaving, setDecisionSaving] = useState(false);
    const [jobs, setJobs] = useState([]);
    const [applications, setApplications] = useState([]);
    const [archivedApplications, setArchivedApplications] = useState([]);
    const [archivedApplicationsLoading, setArchivedApplicationsLoading] = useState(true);
    const [archivedApplicationsError, setArchivedApplicationsError] = useState("");
    const [applicantSearch, setApplicantSearch] = useState("");
    const [archivedApplicantSearch, setArchivedApplicantSearch] = useState("");
    const [jobSearch, setJobSearch] = useState("");
    const [archivingApplicationId, setArchivingApplicationId] = useState(null);
    const [notifications, setNotifications] = useState([]);
    const [notificationsLoading, setNotificationsLoading] = useState(false);
    const [openWarningMenuId, setOpenWarningMenuId] = useState(null);
    const warningMenuRef = useRef(null);
    const dismissedWarningIdsRef = useRef(new Set());
    const [selectedApplication, setSelectedApplication] = useState(null);
    const [inlineResume, setInlineResume] = useState(null);
    useEffect(() => { setInlineResume(null); }, [selectedApplication?.id]);
    const [previewDocument, setPreviewDocument] = useState(null);
    const [previewDocumentError, setPreviewDocumentError] = useState("");
    const [previewDocumentLoading, setPreviewDocumentLoading] = useState(false);
    const documentPreviewUrlRef = useRef(null);
    const documentPreviewRequestRef = useRef(0);
    const { scheduleDelete } = useUndoDelete();
    const [reviewing, setReviewing] = useState(false);
    const [interviewDetailsModalOpen, setInterviewDetailsModalOpen] = useState(false);
    const [interviewDetailsMode, setInterviewDetailsMode] = useState("edit");
    const [interviewDetailsJob, setInterviewDetailsJob] = useState(null);
    const [interviewDetailsDraft, setInterviewDetailsDraft] = useState({ ...EMPTY_INTERVIEW_DETAILS });
    const [interviewDetailsConfigured, setInterviewDetailsConfigured] = useState(false);
    const [interviewDetailsLoading, setInterviewDetailsLoading] = useState(false);
    const [interviewDetailsSaving, setInterviewDetailsSaving] = useState(false);
    const [interviewDetailsLoadError, setInterviewDetailsLoadError] = useState("");
    const [interviewDetailsSaveError, setInterviewDetailsSaveError] = useState("");
    const [profile, setProfile] = useState(null);
    const [logoFile, setLogoFile] = useState(null);
    const [logoSaving, setLogoSaving] = useState(false);
    const [industryValue, setIndustryValue] = useState("");
    const [industrySaving, setIndustrySaving] = useState(false);
    const [form, setForm] = useState(createJobPostingForm);
    const [requirements, setRequirements] = useState([]);
    const [submitting, setSubmitting] = useState(false);
    const jobSubmitInFlight = useRef(false);
    const [message, setMessage] = useState("");
    const [error, setError] = useState("");
    const fileBaseUrl = useMemo(() => API_BASE_URL.replace(/\/api$/, ""), []);
    const [profileLoading, setProfileLoading] = useState(false);
    const [selectedProfile, setSelectedProfile] = useState(null);
    const [showProfileModal, setShowProfileModal] = useState(false);

    const applicantPrintRef = useRef(null);
    const dashboardSectionRef = useRef(null);
    const postJobSectionRef = useRef(null);
    const applicantsSectionRef = useRef(null);
    const profileSectionRef = useRef(null);
    const [activeView, setActiveView] = useState("dashboard");
    const [dashboardPanel, setDashboardPanel] = useState("activity");
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    usePortalDrawer({ open: mobileNavOpen, onClose: () => setMobileNavOpen(false) });
    const [selectedJobId, setSelectedJobId] = useState(null);
    const [jobApplicants, setJobApplicants] = useState([]);
    const [applicantsLoading, setApplicantsLoading] = useState(false);
    const [stopConfirm, setStopConfirm] = useState({ open: false, jobId: null });

    const user = useMemo(() => {
        try {
            return JSON.parse(localStorage.getItem("user") || "null");
        } catch {
            return null;
        }
    }, []);

    const loadJobs = async () => {
        try {
            const data = await api.get("/jobs", true);
            setJobs(Array.isArray(data) ? data : []);
        } catch (err) {
            setError(err.message);
        }
    };

    const loadProfile = async () => {
        try {
            const data = await api.get("/profile", true);
            setProfile(data);
        } catch {
            setProfile(null);
        }
    };

    const loadApplications = async () => {
        setArchivedApplicationsLoading(true);
        setArchivedApplicationsError("");
        try {
            const data = await api.get("/applications/employer", true);
            if (!Array.isArray(data) || !data.every((item) => item && typeof item === "object" && !Array.isArray(item))) {
                throw new Error("The server returned an invalid applicants response.");
            }
            setApplications(data);
        } catch {
            setApplications([]);
        }
        try {
            const data = await api.get("/applications/employer?archived=true", true);
            if (!Array.isArray(data) || !data.every((item) => item && typeof item === "object" && !Array.isArray(item))) {
                throw new Error("The server returned an invalid archived applicants response.");
            }
            setArchivedApplications(data);
        } catch (err) {
            setArchivedApplicationsError(err.message || "Unable to load archived applicants.");
        } finally {
            setArchivedApplicationsLoading(false);
        }
    };

    const loadNotifications = async () => {
        setNotificationsLoading(true);
        try {
            const data = await api.get("/notifications", true);
            const warningNotifications = (Array.isArray(data) ? data : [])
                .filter((item) => item?.type === "warning" && !dismissedWarningIdsRef.current.has(item.id))
                .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
            setNotifications(warningNotifications);
        } catch {
            setNotifications([]);
        } finally {
            setNotificationsLoading(false);
        }
    };

    const loadJobApplicants = async (jobId) => {
        if (!jobId) return;
        setApplicantsLoading(true);
        try {
            const data = await api.get(`/applications/jobs/${jobId}/applicants`, true);
            const sorted = Array.isArray(data) ? data : [];
            sorted.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            setJobApplicants(sorted);
        } catch {
            setJobApplicants([]);
        } finally {
            setApplicantsLoading(false);
        }
    };

    useStrictSafeEffect(
        "EmployerPage:init",
        () => {
            loadJobs();
            loadProfile();
            loadApplications();
            loadNotifications();
            return undefined;
        },
        [],
        { label: "EmployerPage init" }
    );

    useEffect(() => {
        setIndustryValue(profile?.EmployerProfile?.industry || "");
    }, [profile]);

    useEffect(() => {
        if (activeView === "post_job") {
            // Requirement library is intentionally not used in the employer job form.
        }
    }, [activeView]);

    useEffect(() => {
        if (activeView !== "notifications") return undefined;
        loadNotifications();
        const intervalId = window.setInterval(loadNotifications, 15000);
        return () => window.clearInterval(intervalId);
    }, [activeView]);

    useEffect(() => {
        if (openWarningMenuId === null) return undefined;
        const handleOutsideClick = (event) => {
            if (!warningMenuRef.current?.contains(event.target)) setOpenWarningMenuId(null);
        };
        const handleEscape = (event) => {
            if (event.key === "Escape") setOpenWarningMenuId(null);
        };
        document.addEventListener("pointerdown", handleOutsideClick);
        document.addEventListener("keydown", handleEscape);
        return () => {
            document.removeEventListener("pointerdown", handleOutsideClick);
            document.removeEventListener("keydown", handleEscape);
        };
    }, [openWarningMenuId]);

    useEffect(() => {
        if (typeof window === "undefined") return undefined;

        const media = window.matchMedia("(max-width: 1024px)");
        const applyMobileState = (matches) => {
            if (!matches) {
                setMobileNavOpen(false);
            }
        };

        applyMobileState(media.matches);

        const handleChange = (event) => applyMobileState(event.matches);
        media.addEventListener("change", handleChange);
        return () => media.removeEventListener("change", handleChange);
    }, []);

    const markNotificationAsRead = async (id) => {
        try {
            await api.put(`/notifications/read/${id}`, {}, true);
            setNotifications((prev) =>
                prev.map((item) => (item.id === id ? { ...item, isRead: true } : item))
            );
        } catch (err) {
            setError(err.message);
        }
    };

    const deleteWarningNotification = async (item) => {
        setOpenWarningMenuId(null);
        if (!window.confirm("Delete this admin warning notification?")) return;
        try {
            await api.delete(`/notifications/${encodeURIComponent(item.id)}`, true);
            dismissedWarningIdsRef.current.add(item.id);
            setNotifications((prev) => prev.filter((notification) => notification.id !== item.id));
            setMessage("Notification deleted.");
            setError("");
        } catch (deleteError) {
            setError(deleteError.message || "The notification could not be deleted.");
        }
    };

    const renderAvatar = (sender) => {
        const name = sender?.name || user?.name || "U";
        const avatar =
            sender?.admin_avatar_url ||
            sender?.avatar_url ||
            sender?.AlumniProfile?.avatar_url ||
            sender?.EmployerProfile?.logo_url;
        if (avatar) {
            return <div className="chat-mini-avatar" style={{ backgroundImage: `url(${avatar})` }} aria-label={name} />;
        }
        return (
            <div className="chat-mini-avatar fallback" aria-label={name}>
                {name[0]?.toUpperCase() || "U"}
            </div>
        );
    };

    const openProfile = async (userId) => {
        if (!userId) return;
        setProfileLoading(true);
        setSelectedProfile(null);
        setShowProfileModal(true);
        try {
            const data = await api.get(`/profile/${userId}`, true);
            const merged =
                data?.role === "admin" && user?.id === data?.id
                    ? {
                        ...data,
                        admin_department: data.admin_department || user?.admin_department || "",
                        admin_avatar_url: data.admin_avatar_url || user?.admin_avatar_url || ""
                    }
                    : data;
            setSelectedProfile(merged);
        } catch (err) {
            setError(err.message);
            setSelectedProfile(null);
        } finally {
            setProfileLoading(false);
        }
    };

    const getChatProfileSummary = (chatMessage) =>
        chatMessage?.senderType === "admin"
            ? {
                id: chatConversation?.admin?.id,
                name: chatConversation?.admin?.name || "Employer Admin",
                admin_avatar_url: chatConversation?.admin?.admin_avatar_url || "",
                role: "admin"
            }
            : {
                id: user?.id,
                name: profile?.name || user?.name || "Employer",
                avatar_url: profile?.EmployerProfile?.logo_url || "",
                role: "employer"
            };
    const compareAlphabetically = (left, right) => {
        const leftMissing = !String(left ?? "").trim();
        const rightMissing = !String(right ?? "").trim();
        if (leftMissing !== rightMissing) return leftMissing ? 1 : -1;
        return String(left ?? "").localeCompare(String(right ?? ""), undefined, { sensitivity: "base", numeric: true });
    };
    const applicantName = (app) => app?.alumni?.name || app?.full_name || "";
    const sortedApplications = [...applications].sort((a, b) =>
        compareAlphabetically(applicantName(a), applicantName(b)) || compareAlphabetically(a.id, b.id));
    const sortedArchivedApplications = [...archivedApplications].sort((a, b) =>
        compareAlphabetically(applicantName(a), applicantName(b)) || compareAlphabetically(a.id, b.id));
    const matchingApplicants = sortedApplications.filter((app) =>
        `${applicantName(app)} ${app.Job?.title || ""} ${app.status || ""}`.toLocaleLowerCase().includes(applicantSearch.trim().toLocaleLowerCase()));
    const matchingArchivedApplicants = sortedArchivedApplications.filter((app) =>
        `${applicantName(app)} ${app.Job?.title || ""} ${app.status || ""}`.toLocaleLowerCase().includes(archivedApplicantSearch.trim().toLocaleLowerCase()));
    const employerJobs = jobs.filter((job) => job.employer_id === user?.id)
        .sort((a, b) => compareAlphabetically(a.title, b.title) || compareAlphabetically(a.id, b.id));
    const matchingEmployerJobs = employerJobs.filter((job) =>
        `${job.title || ""} ${job.location || ""} ${job.employment_type || ""}`.toLocaleLowerCase().includes(jobSearch.trim().toLocaleLowerCase()));
    const selectedJob = employerJobs.find((job) => job.id === selectedJobId) || null;

    const handleLogout = () => {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        navigate("/");
    };

    const handleViewChange = (view) => {
        setActiveView(view);
        if (view === "post_job") {
            setForm(createJobPostingForm());
            setRequirements([]);
            setInterviewDetailsDraft({ ...EMPTY_INTERVIEW_DETAILS });
            setInterviewDetailsConfigured(false);
        }
        setMobileNavOpen(false);
    };

    const addRequirement = () => {
        setRequirements((prev) => [
            ...prev,
            {
                requirement_code: `custom_${crypto.randomUUID()}`,
                label: "",
                requirement_type: "document_upload",
                value_type: "file",
                required: true,
                is_custom: true,
                sort_order: prev.length
            }
        ]);
    };

    const updateRequirement = (index, field, value) => {
        setRequirements((prev) => {
            const next = [...prev];
            next[index] = { ...next[index], [field]: value, ...(field === "requirement_type" ? { value_type: value === "document_upload" ? "file" : "text" } : {}) };
            return next;
        });
    };

    const removeRequirement = (index) => {
        setRequirements((prev) => {
            const next = prev.filter((_, i) => i !== index);
            return next.map((r, i) => ({ ...r, sort_order: i }));
        });
    };

    const handleCreateJob = async () => {
        if (jobSubmitInFlight.current) return false;
        setMessage("");
        setError("");
        const errors = validateJobPosting(form, requirements);
        if (errors.length) { setError(errors.join(" ")); return false; }
        jobSubmitInFlight.current = true;
        setSubmitting(true);
        try {
            await api.post("/jobs", jobPostingPayload(form, requirements), true);
            setMessage("Job posted successfully.");
            setForm(createJobPostingForm());
            setRequirements([]);
            setInterviewDetailsDraft({ ...EMPTY_INTERVIEW_DETAILS });
            setInterviewDetailsConfigured(false);
            await loadJobs();
            await loadApplications();
            setActiveView("dashboard");
            return true;
        } catch (err) {
            setError(err.message);
            return false;
        } finally {
            jobSubmitInFlight.current = false;
            setSubmitting(false);
        }
    };

    const handleDeleteJob = (job) => {
        setJobs((prev) => prev.filter((j) => j.id !== job.id));
        scheduleDelete({
            item: job,
            itemName: job.title || "Job",
            message: "The job was deleted.",
            deleteAction: () => api.delete(`/jobs/${job.id}`, true),
            restoreAction: () => {
                setJobs((prev) => {
                    const exists = prev.find((j) => j.id === job.id);
                    if (exists) return prev;
                    return [...prev, job].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
                });
            },
        });
    };

    const openStopConfirm = (jobId) => {
        setStopConfirm({ open: true, jobId });
    };

    const closeStopConfirm = () => {
        setStopConfirm({ open: false, jobId: null });
    };

    const confirmStopRecruitment = async () => {
        const jobId = stopConfirm.jobId;
        if (!jobId) return;
        try {
            await api.post(`/jobs/${jobId}/stop-recruitment`, {}, true);
            setMessage("Recruitment stopped successfully.");
            setJobs((prev) =>
                prev.map((j) => (j.id === jobId ? { ...j, recruitment_status: "closed" } : j))
            );
            if (selectedJobId === jobId) {
                setJobApplicants([]);
            }
        } catch (err) {
            setError(err.message);
        } finally {
            closeStopConfirm();
        }
    };

    const handleReactivateRecruitment = async (jobId) => {
        try {
            await api.post(`/jobs/${jobId}/reactivate-recruitment`, {}, true);
            setMessage("Recruitment activated again successfully.");
            setJobs((prev) =>
                prev.map((j) => (j.id === jobId ? { ...j, recruitment_status: "active" } : j))
            );
            if (selectedJobId === jobId) {
                loadJobApplicants(jobId);
            }
        } catch (err) {
            setError(err.message);
        }
    };

    const openJobApplicants = (job) => {
        setSelectedJobId(job.id);
        loadJobApplicants(job.id);
        setActiveView("applicants");
    };

    const openJobInterviewDetails = async (job) => {
        if (!job?.id) return;
        setError("");
        setMessage("");
        setInterviewDetailsMode("edit");
        setInterviewDetailsJob(job);
        setInterviewDetailsDraft({ ...EMPTY_INTERVIEW_DETAILS });
        setInterviewDetailsConfigured(false);
        setInterviewDetailsLoadError("");
        setInterviewDetailsSaveError("");
        setInterviewDetailsLoading(true);
        setInterviewDetailsModalOpen(true);
        try {
            const result = await api.get(`/jobs/${job.id}/interview-details`, true);
            setInterviewDetailsJob({ ...job, ...result.job });
            setInterviewDetailsDraft({ ...EMPTY_INTERVIEW_DETAILS, ...(result.interview_details || {}) });
            setInterviewDetailsConfigured(Boolean(result.configured));
        } catch (err) {
            setInterviewDetailsLoadError(err.message || "Unable to load interview details.");
        } finally {
            setInterviewDetailsLoading(false);
        }
    };

    const saveInterviewDetails = async () => {
        if (interviewDetailsSaving) return;
        setInterviewDetailsSaving(true);
        setInterviewDetailsSaveError("");
        setError("");
        try {
            if (interviewDetailsJob?.id) {
                const result = await api.put(`/jobs/${interviewDetailsJob.id}/interview-details`, {
                    interview_details: interviewDetailsDraft
                }, true);
                const savedDetails = { ...EMPTY_INTERVIEW_DETAILS, ...(result.interview_details || interviewDetailsDraft) };
                const columns = {
                    interview_venue: savedDetails.venue,
                    interview_place: savedDetails.place,
                    interview_date: savedDetails.date,
                    interview_time: savedDetails.time,
                    interview_contact_info: savedDetails.contact_info,
                    interview_what_to_bring: savedDetails.what_to_bring
                };
                setJobs((previous) => previous.map((job) => Number(job.id) === Number(interviewDetailsJob.id) ? { ...job, ...columns } : job));
                setInterviewDetailsDraft(savedDetails);
                setInterviewDetailsConfigured(true);
                setMessage(result.msg || "Interview details updated.");
            }
            setInterviewDetailsModalOpen(false);
        } catch (err) {
            const message = err.message || "Unable to save interview details.";
            setInterviewDetailsSaveError(message);
            setError(message);
        } finally {
            setInterviewDetailsSaving(false);
        }
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
            setJobApplicants(update);
            setSelectedApplication(previous => previous?.id === selectedApplication.id
                ? { ...previous, status: result.application?.status || status } : previous);
            setMessage(result.msg);
        } catch (err) { setError(err.message || "Unable to update application."); }
        finally { decisionBusy.current = false; setDecisionSaving(false); }
    };

    const updateApplicationArchive = async (application, archive) => {
        if (!application?.id || archivingApplicationId) return;
        const action = archive ? "archive" : "restore";
        const confirmed = window.confirm(`${archive ? "Archive" : "Restore"} this application?`);
        if (!confirmed) return;

        setArchivingApplicationId(application.id);
        setError("");
        setMessage("");
        try {
            const result = await api.put(`/applications/${application.id}/${action}`, {}, true);
            setMessage(result?.msg || (archive ? "Application archived." : "Application restored."));
            if (archive) {
                setApplications((current) => current.filter((item) => item.id !== application.id));
                if (result?.application) setArchivedApplications((current) => [result.application, ...current.filter((item) => item.id !== application.id)]);
            } else {
                setArchivedApplications((current) => current.filter((item) => item.id !== application.id));
                if (result?.application) setApplications((current) => [result.application, ...current.filter((item) => item.id !== application.id)]);
            }
            await loadApplications();
        } catch (err) {
            setError(err.message || `Unable to ${action} application.`);
        } finally {
            setArchivingApplicationId(null);
        }
    };

    const handlePrintApplication = () => {
        if (!applicantPrintRef.current) return;

        const printWindow = window.open("", "_blank", "width=980,height=720");
        if (!printWindow) return;

        const styles = Array.from(document.querySelectorAll("style, link[rel=\"stylesheet\"]"))
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

    const getDocumentPreviewType = (documentEntry, blob) => {
        const fileName = String(documentEntry?.file_name || "").toLowerCase();
        const mimeType = String(blob?.type || documentEntry?.mime_type || "").split(";")[0].trim().toLowerCase();
        if (mimeType.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|avif)$/.test(fileName)) return "image";
        if (mimeType === "application/pdf" || fileName.endsWith(".pdf")) return "pdf";
        return "file";
    };

    const assertDocumentBlob = (blob) => {
        const mimeType = String(blob?.type || "").split(";")[0].trim().toLowerCase();
        if (!blob?.size || mimeType === "text/html" || mimeType === "application/json" || mimeType.endsWith("+json")) {
            throw new Error("The server did not return the uploaded document. Please try again or contact support.");
        }
    };

    const previewDocumentFile = async (documentEntry, applicationId) => {
        const requestId = ++documentPreviewRequestRef.current;
        if (documentPreviewUrlRef.current) URL.revokeObjectURL(documentPreviewUrlRef.current);
        documentPreviewUrlRef.current = null;
        setPreviewDocument(null);
        if (!applicationId || (!documentEntry?.id && !documentEntry?.isLegacyResume)) {
            setPreviewDocumentError("This application document is missing its file record.");
            setPreviewDocumentLoading(false);
            return;
        }

        setPreviewDocumentLoading(true);
        setPreviewDocumentError("");

        try {
            // Use the authorized application/document route. The response API may expose
            // opaque secure-storage URLs, which do not contain a usable file extension.
            const fileUrl = getApplicantResumeFileUrl(applicationId, documentEntry);
            const blob = await fetchFile(fileUrl, true);
            if (requestId !== documentPreviewRequestRef.current) return;
            assertDocumentBlob(blob);

            const objectUrl = URL.createObjectURL(blob);
            documentPreviewUrlRef.current = objectUrl;
            setPreviewDocument({
                url: objectUrl,
                type: getDocumentPreviewType(documentEntry, blob),
                fileName: documentEntry.file_name || "document"
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

    const downloadApplicationDocument = async (documentEntry, applicationId) => {
        if (!applicationId || (!documentEntry?.id && !documentEntry?.isLegacyResume)) {
            setPreviewDocumentError("This application document is missing its file record.");
            setPreviewDocument(null);
            return;
        }
        try {
            const fileUrl = getApplicantResumeFileUrl(applicationId, documentEntry);
            const blob = await fetchFile(fileUrl, true);
            assertDocumentBlob(blob);
            const objectUrl = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = objectUrl;
            link.download = String(documentEntry.file_name || "document").replace(/[\\/:*?"<>|\r\n]/g, "_");
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
        } catch (error) {
            setPreviewDocumentError(error.message || "The document could not be downloaded.");
        }
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

    const fileToDataUrl = (file) =>
        new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });

    const handleLogoUpload = async () => {
        if (!logoFile || !profile) {
            setError("Please select a logo image first.");
            return;
        }
        setLogoSaving(true);
        setMessage("");
        setError("");

        try {
            const logoUrl = await fileToDataUrl(logoFile);
            await api.put(
                "/profile",
                {
                    name: profile.name,
                    email: profile.email,
                    organization_name: profile.EmployerProfile?.organization_name || "",
                    industry: industryValue || "",
                    address: profile.EmployerProfile?.address || "",
                    contact_email: profile.EmployerProfile?.contact_email || profile.email,
                    logo_url: logoUrl
                },
                true
            );
            setMessage("Organization logo updated.");
            setLogoFile(null);
            await loadProfile();
        } catch (err) {
            setError(err.message);
        } finally {
            setLogoSaving(false);
        }
    };

    const handleIndustrySave = async () => {
        if (!profile) {
            setError("Profile not loaded yet.");
            return;
        }

        setIndustrySaving(true);
        setMessage("");
        setError("");

        try {
            await api.put(
                "/profile",
                {
                    name: profile.name,
                    email: profile.email,
                    organization_name: profile.EmployerProfile?.organization_name || "",
                    industry: industryValue || "",
                    address: profile.EmployerProfile?.address || "",
                    contact_email: profile.EmployerProfile?.contact_email || profile.email,
                    logo_url: profile.EmployerProfile?.logo_url || ""
                },
                true
            );
            setMessage("Industry updated.");
            await loadProfile();
        } catch (err) {
            setError(err.message);
        } finally {
            setIndustrySaving(false);
        }
    };

    const isEmployerAdmin = user?.role === "admin" && user?.admin_scope === "employer";
    if (!user || (user.role !== "employer" && !isEmployerAdmin)) {
        return (
            <div className="role-page">
                <Card className="role-card">
                    <Card.Body>
                        <h3>Employer Access Only</h3>
                        <p>Please log in using an employer account.</p>
                        <Link to="/login/employer">Go to Login</Link>
                    </Card.Body>
                </Card>
            </div>
        );
    }

    const employerProfile = profile?.EmployerProfile;
    const orgName = employerProfile?.organization_name || profile?.name || "Organization";
    const contactEmail = employerProfile?.contact_email || profile?.email || "N/A";
    const industry = employerProfile?.industry || "Not specified";
    const address = employerProfile?.address || "Municipality of San Jose";
    const isVerified = employerProfile?.verified === true;
    const selectedDisability = parseArrayField(selectedApplication?.disability);
    const selectedLanguages = parseArrayField(selectedApplication?.languages);
    const selectedOtherSkills = parseArrayField(selectedApplication?.other_skills);
    const unreadWarningCount = notifications.filter((item) => !item.isRead).length;
    const waitingForApprovalApplicants = jobApplicants.filter((app) => String(app.status || "").toLowerCase() === "pending");
    const readyForInterviewApplicants = jobApplicants.filter((app) => String(app.status || "").toLowerCase() === "verified");
    const otherStatusApplicants = jobApplicants.filter((app) => !["pending", "verified"].includes(String(app.status || "").toLowerCase()));

    const renderJobApplicantRows = (applicants, emptyMessage, otherStatuses = false) => applicants.length ? (
        applicants.map((app) => {
            const status = String(app.status || "").toLowerCase();
            const otherLabel = status === "not_verified"
                ? "NOT APPROVED"
                : status.replaceAll("_", " ").toUpperCase() || "UNKNOWN STATUS";
            return (
                <div className="emp-list-item employer-job-applicant-row" key={`app-${app.id}`}>
                    <div className="emp-list-item-left">
                        <strong>{app.alumni?.name || app.full_name || "Unknown Applicant"}</strong>
                        <p>Cycle {app.recruitment_cycle || 1} | {new Date(app.createdAt).toLocaleDateString()}</p>
                    </div>
                    <div className="emp-list-item-right">
                        <ApplicationStatusBadge
                            status={app.status}
                            pendingLabel="WAITING FOR APPROVAL"
                            labelOverride={otherStatuses ? otherLabel : undefined}
                            classNameOverride={otherStatuses && ["not_verified", "rejected"].includes(status) ? "rejected" : undefined}
                        />
                        <button type="button" className="emp-view-btn" onClick={() => openApplicationDetails(app)}>View</button>
                    </div>
                </div>
            );
        })
    ) : <p className="employer-job-applicant-empty">{emptyMessage}</p>;

    const viewConfig = {
        dashboard: {
            title: isEmployerAdmin ? "Employer Admin Dashboard" : "Employer Dashboard",
            description: "Manage your organization profile, active job postings, and incoming alumni applications from one workspace."
        },
        profile: {
            title: "Organization Profile",
            description: "Review and update your employer details, logo, and organization information."
        },
        messages: {
            title: "Messages",
            description: "Stay connected with the employer admin and keep the conversation in one place."
        },
        notifications: {
            title: "Notifications",
            description: "Receive admin warning notices in one place and review them when needed."
        },
        post_job: {
            title: "Create Job Posting",
            description: "Create a professional job opportunity for DJEMC alumni."
        },
        applicants: {
            title: "Job-Specific Applicants",
            description: selectedJob
                ? `Review current-cycle applicants for ${selectedJob.title}.`
                : "Select a job to view its applicants."
        },
        manage_jobs: {
            title: "Manage Posted Jobs",
            description: "View and manage jobs you have posted."
        }
    };

    const currentView = viewConfig[activeView] || viewConfig.dashboard;

    const sortedActivity = [...employerJobs.map(job => ({ ...job, _type: "job", _label: "New Job Posted", _desc: `${job.title} - ${job.location}` })), ...applications.map(app => ({ ...app, _type: "app", _label: "New Application", _desc: `${app.alumni?.name || app.full_name || "Unknown"} applied for ${app.Job?.title || "a position"}` }))].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const renderRequirementFields = () => (
        <div className="mt-3 application-requirements-wrapper">
            <h6>Application Requirements</h6>
            <p className="text-muted small mb-2">Define the documents and information applicants must submit. Add at least one requirement.</p>

            {requirements.map((req, idx) => (
                <div key={idx} className="border rounded p-3 mb-2 requirement-item">
                    <Row className="align-items-end">
                        <Col md={4}>
                            <Form.Group className="mb-0">
                                <Form.Label>Label</Form.Label>
                                <Form.Control
                                    type="text"
                                    value={req.label}
                                    onChange={(e) => updateRequirement(idx, "label", e.target.value)}
                                    placeholder="e.g. NBI Clearance"
                                />
                            </Form.Group>
                        </Col>
                        <Col md={3}>
                            <Form.Group className="mb-0">
                                <Form.Label>Type</Form.Label>
                                <Form.Select
                                    value={req.requirement_type}
                                    onChange={(e) => updateRequirement(idx, "requirement_type", e.target.value)}
                                >
                                    <option value="document_upload">Document Upload</option>
                                    <option value="information_field">Information Field</option>
                                </Form.Select>
                            </Form.Group>
                        </Col>
                        {req.requirement_type === "information_field" && (
                            <Col md={3}>
                                <Form.Group className="mb-0">
                                    <Form.Label>Input Type</Form.Label>
                                    <Form.Select
                                        value={req.value_type || "text"}
                                        onChange={(e) => updateRequirement(idx, "value_type", e.target.value)}
                                    >
                                        <option value="text">Text</option>
                                        <option value="textarea">Textarea</option>
                                        <option value="number">Number</option>
                                        <option value="date">Date</option>
                                    </Form.Select>
                                </Form.Group>
                            </Col>
                        )}
                        <Col md={2}>
                            <div className="d-flex align-items-center gap-3">
                                <Form.Check
                                    type="switch"
                                    label="Req"
                                    checked={req.required}
                                    onChange={(e) =>
                                        updateRequirement(idx, "required", e.target.checked)
                                    }
                                />

                                <Button
                                    variant="outline-danger"
                                    size="sm"
                                    onClick={() => removeRequirement(idx)}
                                    title="Delete Requirement"
                                    aria-label="Delete Requirement"
                                >
                                    <BsTrash />
                                </Button>
                            </div>
                        </Col>
                    </Row>
                    {req.requirement_type === "document_upload" && (
                        <Row className="mt-2">
                            <Col md={7}>
                                <Form.Group className="mb-0">
                                    <Form.Label className="small">Allowed Types</Form.Label>
                                    <Form.Control
                                        size="sm"
                                        type="text"
                                        value={req.allowed_types || ""}
                                        onChange={(e) => updateRequirement(idx, "allowed_types", e.target.value)}
                                        placeholder="pdf,doc,docx,png,jpg"
                                    />
                                </Form.Group>
                            </Col>
                        </Row>
                    )}
                </div>
            ))}

            <div className="d-flex gap-2 mt-2 application-requirements-actions interview-requirements-actions">
                <Button variant="outline-primary" size="sm" onClick={addRequirement}>
                    + Custom Requirement
                </Button>
            </div>
        </div>
    );

    return (
        <>
            <div className={`employer-page ${styles.sidebarLayout}`}>
                <div
                    className={`${styles.sidebarOverlay}${mobileNavOpen ? " visible" : ""}`}
                    onClick={() => setMobileNavOpen(false)}
                    aria-hidden={!mobileNavOpen}
                />

                <button
                    type="button"
                    className={styles.mobileNavToggle}
                    onClick={() => setMobileNavOpen((prev) => !prev)}
                    aria-label={mobileNavOpen ? "Close navigation" : "Open navigation"}
                    aria-expanded={mobileNavOpen}
                >
                    {mobileNavOpen ? <FiX /> : <FiMenu />}
                </button>

                <aside className={`${styles.sidebar}${mobileNavOpen ? " open" : ""}`}>
                    <div className={styles.sidebarCard}>
                        <div className={styles.sidebarTitle}>Navigation</div>
                        <div className={styles.sidebarNav}>
                            <button type="button" className={`${styles.navItem} ${activeView === "dashboard" ? "active" : ""}`} onClick={() => handleViewChange("dashboard")}>
                                <FaHome className={styles.navIcon} />
                                Dashboard
                            </button>
                            <button type="button" className={`${styles.navItem} ${activeView === "profile" ? "active" : ""}`} onClick={() => handleViewChange("profile")}>
                                <FaUser className={styles.navIcon} />
                                Profile
                            </button>
                            <button type="button" className={`${styles.navItem} ${activeView === "messages" ? "active" : ""}`} onClick={() => handleViewChange("messages")}>
                                <FaEnvelope className={styles.navIcon} />
                                Messages
                            </button>
                            <button type="button" className={`${styles.navItem} ${activeView === "post_job" ? "active" : ""}`} onClick={() => handleViewChange("post_job")}>
                                <FaBriefcase className={styles.navIcon} />
                                Post Job
                            </button>
                            <button type="button" className={`${styles.navItem} ${activeView === "manage_jobs" ? "active" : ""}`} onClick={() => handleViewChange("manage_jobs")}>
                                <FaUsers className={styles.navIcon} />
                                                            Manage Posted Jobs
                            </button>
                            <button
                                type="button"
                                className={styles.navItem}
                                onClick={() => {
                                    setMobileNavOpen(false);
                                    handleLogout();
                                }}
                            >
                                <FaSignOutAlt className={styles.navIcon} />
                                Logout
                            </button>
                        </div>
                    </div>
                </aside>

                <div className={styles.main}>
                    <div className="employer-header" ref={dashboardSectionRef}>
                        <div>
                            <h2>{currentView.title}</h2>
                            <p>{currentView.description}</p>
                        </div>
                        <div
                            className="employer-bell"
                            role="button"
                            tabIndex={0}
                            onClick={() => handleViewChange("notifications")}
                            onKeyPress={(e) => e.key === "Enter" && handleViewChange("notifications")}
                        >
                            <FiBell />
                            {unreadWarningCount > 0 && <span className="employer-bell-badge">{unreadWarningCount}</span>}
                        </div>
                    </div>

                    {message && <p className="role-success">{message}</p>}
                    {error && <p className="role-error">{error}</p>}
                    {activeView === "notifications" && (
                        <Card className="employer-card jobs-card employer-notifications-card">
                            <Card.Body>
                                <div className="jobs-head employer-notifications-head">
                                    <h4>Admin Warning Notifications</h4>
                                    <span>{unreadWarningCount} unread</span>
                                </div>
                                <p className="form-note">
                                    Only warning notifications sent by admin are shown here.
                                </p>
                                {notificationsLoading && (
                                    <div className="text-muted mb-2">
                                        <Spinner animation="border" size="sm" /> Loading warnings...
                                    </div>
                                )}
                                {!notificationsLoading && notifications.length === 0 && (
                                    <p className="empty-jobs">No admin warnings yet.</p>
                                )}
                                <div className="employer-warning-list">
                                    {notifications.map((item) => (
                                        <div
                                            key={item.id}
                                            className={`employer-warning-item ${item.isRead ? "read" : "unread"}`}
                                        >
                                            <div className="employer-warning-top">
                                                <div>
                                                    <strong>Admin Warning</strong>
                                                    <p>{new Date(item.createdAt).toLocaleString()}</p>
                                                </div>
                                                <div className="employer-warning-actions">
                                                    {!item.isRead && (
                                                        <Button
                                                            size="sm"
                                                            variant="outline-warning"
                                                            onClick={() => markNotificationAsRead(item.id)}
                                                        >
                                                            Mark as Read
                                                        </Button>
                                                    )}
                                                    <div
                                                        className="employer-warning-menu-wrap"
                                                        ref={openWarningMenuId === item.id ? warningMenuRef : null}
                                                    >
                                                        <button
                                                            type="button"
                                                            className="employer-warning-menu-trigger"
                                                            aria-label="Notification actions"
                                                            aria-haspopup="menu"
                                                            aria-expanded={openWarningMenuId === item.id}
                                                            onClick={() => setOpenWarningMenuId((current) => current === item.id ? null : item.id)}
                                                        >
                                                            <FiMoreHorizontal aria-hidden="true" />
                                                        </button>
                                                        {openWarningMenuId === item.id && (
                                                            <div className="employer-warning-menu" role="menu">
                                                                <button
                                                                    type="button"
                                                                    role="menuitem"
                                                                    onClick={() => deleteWarningNotification(item)}
                                                                >
                                                                    <BsTrash aria-hidden="true" />
                                                                    Delete
                                                                </button>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                            <Alert
                                                variant={item.isRead ? "light" : "warning"}
                                                className="employer-warning-alert"
                                            >
                                                {item.message}
                                            </Alert>
                                        </div>
                                    ))}
                                </div>
                            </Card.Body>
                        </Card>
                    )}
                    {activeView === "messages" && (
                        <div className="employer-message-embed">
                            <EmployerMessagesPage />
                        </div>
                    )}

                    {activeView === "applicants" && (
                        <div className="employer-applicants-page">
                            <Card className="employer-card jobs-card employer-applicants-card">
                                <Card.Body>
                                    <div className="jobs-head">
                                        <h4>
                                            {selectedJob
                                                ? `Applicants for: ${selectedJob.title}`
                                                : "Select a Job"}
                                        </h4>
                                        <span>
                                            {selectedJob
                                                ? `${jobApplicants.length} current-cycle applicant${jobApplicants.length === 1 ? "" : "s"}`
                                                : "No job selected"}
                                        </span>
                                    </div>
                                    {!selectedJob ? (
                                        <div className="emp-dash-empty">
                                            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /></svg>
                                            <p>Choose a job from your job list to view its applicants.</p>
                                        </div>
                                    ) : applicantsLoading ? (
                                        <div className="text-center my-4">
                                            <Spinner animation="border" size="sm" /> Loading applicants...
                                        </div>
                                    ) : (
                                        <div className="employer-job-applicant-sections">
                                            <section className="employer-job-applicant-section" aria-labelledby="waiting-approval-heading">
                                                <div className="employer-job-applicant-section-head">
                                                    <h5 id="waiting-approval-heading">Waiting for Approval</h5>
                                                    <span>{waitingForApprovalApplicants.length}</span>
                                                </div>
                                                {renderJobApplicantRows(waitingForApprovalApplicants, "No applicants waiting for approval.")}
                                            </section>
                                            <section className="employer-job-applicant-section" aria-labelledby="ready-interview-heading">
                                                <div className="employer-job-applicant-section-head">
                                                    <h5 id="ready-interview-heading">Approved Applicants</h5>
                                                    <span>{readyForInterviewApplicants.length}</span>
                                                </div>
                                                {renderJobApplicantRows(readyForInterviewApplicants, "No approved applicants.")}
                                            </section>
                                            {otherStatusApplicants.length > 0 && (
                                                <section className="employer-job-applicant-section employer-job-applicant-other" aria-labelledby="other-applicants-heading">
                                                    <div className="employer-job-applicant-section-head">
                                                        <h5 id="other-applicants-heading">Other Application Statuses</h5>
                                                        <span>{otherStatusApplicants.length}</span>
                                                    </div>
                                                    {renderJobApplicantRows(otherStatusApplicants, "No other applicants.", true)}
                                                </section>
                                            )}
                                        </div>
                                    )}
                                </Card.Body>
                            </Card>
                        </div>
                    )}

                    {activeView === "manage_jobs" && (
                        <div className="employer-manage-jobs-page">
                            <Card className="employer-card jobs-card">
                                <Card.Body>
                                    <div className="jobs-head">
                                        <h4>List of Jobs</h4>
                                        <span>{employerJobs.length} total</span>
                                    </div>
                                    <Form.Control className="employer-record-search" type="search" value={jobSearch} onChange={(event) => setJobSearch(event.target.value)} placeholder="Search jobs by title or location" aria-label="Search posted jobs" />
                                    <div className="employer-jobs-scrollable">
                                        {employerJobs.length === 0 ? (
                                            <p className="empty-jobs">No jobs posted yet.</p>
                                        ) : matchingEmployerJobs.length === 0 ? (
                                            <p className="empty-jobs">No jobs match your search.</p>
                                        ) : (
                                            matchingEmployerJobs.map((job) => (
                                                <div className="emp-list-item" key={job.id}>
                                                    <div className="emp-list-item-left">
                                                        <strong>{job.title}</strong>
                                                        <p>
                                                            {job.location}
                                                            {job.expected_salary ? ` • ${job.expected_salary}` : ""}
                                                        </p>
                                                    </div>
                                                    <div className="emp-list-item-right emp-job-actions">
                                                        <span className={`emp-status-badge ${job.recruitment_status === "closed" ? "rejected" : "approved"}`}>
                                                            {job.recruitment_status === "closed" ? "Closed" : "Active"}
                                                        </span>
                                                        <span className="emp-type-tag">{getEmploymentTypeLabel(job.employment_type)}</span>
                                                        <button type="button" className="emp-view-btn emp-manage-applicants-btn" onClick={() => openJobApplicants(job)}>
                                                            Manage Applicants
                                                        </button>
                                                        {!hideRecruitmentActions && job.recruitment_status !== "closed" ? (
                                                            <button type="button" className="emp-stop-btn" onClick={() => openStopConfirm(job.id)}>
                                                                Stop Recruitment
                                                            </button>
                                                        ) : null}
                                                        {!hideRecruitmentActions && job.recruitment_status === "closed" ? (
                                                            <button type="button" className="emp-reactivate-btn" onClick={() => handleReactivateRecruitment(job.id)}>
                                                                Reactivate Recruitment
                                                            </button>
                                                        ) : null}
                                                        <button type="button" className="emp-delete-btn" onClick={() => handleDeleteJob(job)} title="Delete job" aria-label={`Delete ${job.title || "job"}`}>
                                                            <BsTrash className="emp-delete-icon" aria-hidden="true" />
                                                        </button>
                                                    </div>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </Card.Body>
                            </Card>
                        </div>
                    )}
                    {activeView === "dashboard" && (
                        <>
                            <div className="emp-dash-metrics">
                                <button
                                    type="button"
                                    className={`emp-dash-card ${dashboardPanel === "activity" ? "active" : ""}`}
                                    onClick={() => setDashboardPanel("activity")}
                                >
                                    <div className="emp-dash-card-icon pulse-icon">
                                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>
                                    </div>
                                    <div className="emp-dash-card-count">{employerJobs.length + applications.length}</div>
                                    <div className="emp-dash-card-label">Recent Activity</div>
                                </button>
                                <button
                                    type="button"
                                    className={`emp-dash-card ${dashboardPanel === "jobs" ? "active" : ""}`}
                                    onClick={() => setDashboardPanel("jobs")}
                                >
                                    <div className="emp-dash-card-icon briefcase-icon">
                                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></svg>
                                    </div>
                                    <div className="emp-dash-card-count">{employerJobs.length}</div>
                                    <div className="emp-dash-card-label">Posted Jobs</div>
                                </button>
                                <button
                                    type="button"
                                    className={`emp-dash-card ${dashboardPanel === "applicants" ? "active" : ""}`}
                                    onClick={() => setDashboardPanel("applicants")}
                                >
                                    <div className="emp-dash-card-icon users-icon">
                                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><circle cx="23" cy="7" r="4" /></svg>
                                    </div>
                                    <div className="emp-dash-card-count">{applications.length}</div>
                                    <div className="emp-dash-card-label">Applicants</div>
                                </button>
                            </div>

                            <div className="emp-dash-panel">
                                {dashboardPanel === "activity" && (
                                    <div className="emp-dash-panel-inner fade-in">
                                        <div className="emp-dash-panel-header">
                                            <h3>Recent Activity</h3>
                                        </div>
                                        {sortedActivity.length === 0 ? (
                                            <div className="emp-dash-empty">
                                                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>
                                                <p>No recent activity yet. Start by posting a job or reviewing applications.</p>
                                            </div>
                                        ) : (
                                            <div className="emp-activity-feed">
                                                {sortedActivity.slice(0, 8).map((item, idx) => (
                                                    <div className="emp-activity-item" key={`${item._type}-${item.id || idx}`} style={{ animationDelay: `${idx * 60}ms` }}>
                                                        <div className={`emp-activity-icon ${item._type === "job" ? "job-icon" : "app-icon"}`}>
                                                            {item._type === "job" ? (
                                                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></svg>
                                                            ) : (
                                                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                                                            )}
                                                        </div>
                                                        <div className="emp-activity-content">
                                                            <strong>{item._label}</strong>
                                                            <p>{item._desc}</p>
                                                            <span className="emp-activity-date">{new Date(item.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}
                                {dashboardPanel === "jobs" && (
                                    <div className="emp-dash-panel-inner fade-in">
                                        <div className="emp-dash-panel-header">
                                            <h3>My Job Listings</h3>
                                            <span>{employerJobs.length} total</span>
                                        </div>
                                        {employerJobs.length === 0 ? (
                                            <div className="emp-dash-empty">
                                                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></svg>
                                                <p>No jobs posted yet.</p>
                                            </div>
                                        ) : (
                                            employerJobs.map((job) => (
                                                <div className="emp-list-item" key={job.id}>
                                                    <div className="emp-list-item-left">
                                                        <strong>{job.title}</strong>
                                                        <p>
                                                            {job.location}
                                                            {job.expected_salary ? ` • ${job.expected_salary}` : ""}
                                                        </p>
                                                    </div>
                                                    <div className="emp-list-item-right emp-job-actions">
                                                        <span className={`emp-status-badge ${job.recruitment_status === "closed" ? "rejected" : "approved"}`}>
                                                            {job.recruitment_status === "closed" ? "Closed" : "Active"}
                                                        </span>
                                                        <span className="emp-type-tag">{getEmploymentTypeLabel(job.employment_type)}</span>
                                                        <button type="button" className="emp-view-btn emp-manage-applicants-btn" onClick={() => openJobApplicants(job)}>
                                                            Manage Applicants
                                                        </button>
                                                        {!hideRecruitmentActions && job.recruitment_status !== "closed" ? (
                                                            <button type="button" className="emp-stop-btn" onClick={() => openStopConfirm(job.id)}>
                                                                Stop Recruitment
                                                            </button>
                                                        ) : null}
                                                        {!hideRecruitmentActions && job.recruitment_status === "closed" ? (
                                                            <button type="button" className="emp-reactivate-btn" onClick={() => handleReactivateRecruitment(job.id)}>
                                                                Reactivate Recruitment
                                                            </button>
                                                        ) : null}
                                                        <button type="button" className="emp-delete-btn" onClick={() => handleDeleteJob(job)} title="Delete job" aria-label={`Delete ${job.title || "job"}`}>
                                                            <BsTrash className="emp-delete-icon" aria-hidden="true" />
                                                        </button>
                                                    </div>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                )}
                                {dashboardPanel === "applicants" && (
                                    <div className="emp-dash-panel-inner employer-record-panel fade-in">
                                        <div className="emp-dash-panel-header">
                                            <h3>Recent Applicants</h3>
                                            <span>{applications.length} total</span>
                                        </div>
                                        <Form.Control className="employer-record-search" type="search" value={applicantSearch} onChange={(event) => setApplicantSearch(event.target.value)} placeholder="Search applicants by name, job, or status" aria-label="Search applicants" />
                                        {applications.length === 0 ? (
                                            <div className="emp-dash-empty">
                                                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /></svg>
                                                <p>No applications yet.</p>
                                            </div>
                                        ) : matchingApplicants.length === 0 ? (
                                            <div className="emp-dash-empty"><p>No applicants match your search.</p></div>
                                        ) : (
                                            <div className="employer-record-list">{matchingApplicants.map((app) => (
                                                <div className="emp-list-item employer-record-item" key={`app-${app.id}`}>
                                                    <div className="emp-list-item-left">
                                                        <strong>{app.alumni?.name || app.full_name || "Unknown Applicant"}</strong>
                                                        <p>{app.Job?.title || "Job"} | Applied {new Date(app.createdAt).toLocaleDateString()}</p>
                                                    </div>
                                                    <div className="emp-list-item-right">
                                                        <ApplicationStatusBadge status={app.status} />
                                                        <button type="button" className="emp-view-btn" onClick={() => openApplicationDetails(app)}>View</button>
                                                    </div>
                                                </div>
                                            ))}</div>
                                        )}
                                    </div>
                                )}
                                {dashboardPanel === "active" && (
                                    <div className="emp-dash-panel-inner fade-in">
                                        <div className="emp-dash-panel-header">
                                            <h3>Active Jobs</h3>
                                            <span>{employerJobs.length} total</span>
                                        </div>
                                        {employerJobs.length === 0 ? (
                                            <div className="emp-dash-empty">
                                                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
                                                <p>No active jobs yet.</p>
                                            </div>
                                        ) : (
                                            employerJobs.map((job) => (
                                                <div className="emp-list-item" key={`active-${job.id}`}>
                                                    <div className="emp-list-item-left">
                                                        <strong>{job.title}</strong>
                                                        <p>{job.location} {job.expected_salary ? `• ${job.expected_salary}` : ""}</p>
                                                    </div>
                                                    <div className="emp-list-item-right">
                                                        <span className="emp-status-badge approved">Active</span>
                                                        <span className="emp-type-tag">{getEmploymentTypeLabel(job.employment_type)}</span>
                                                    </div>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                )}
                                {dashboardPanel === "shortlisted" && (
                                    <div className="emp-dash-panel-inner fade-in">
                                        <div className="emp-dash-panel-header">
                                            <h3>Shortlisted Applicants</h3>
                                            <span>{applications.filter(a => a.status === "verified").length} shortlisted</span>
                                        </div>
                                        {applications.filter(a => a.status === "verified").length === 0 ? (
                                            <div className="emp-dash-empty">
                                                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
                                                <p>No shortlisted applicants yet.</p>
                                            </div>
                                        ) : (
                                            applications.filter(a => a.status === "verified").map((app) => (
                                                <div className="emp-list-item" key={`short-${app.id}`}>
                                                    <div className="emp-list-item-left">
                                                        <strong>{app.alumni?.name || app.full_name || "Unknown Applicant"}</strong>
                                                        <p>{app.Job?.title || "Job"} • Verified</p>
                                                    </div>
                                                    <div className="emp-list-item-right">
                                                        <button type="button" className="emp-view-btn" onClick={() => openApplicationDetails(app)}>View</button>
                                                    </div>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                )}
                            </div>
                        </>
                    )}

                    {(activeView === "profile") && (
                        <div className="employer-grid employer-grid-profile">
                            <Card className="employer-card profile-card" ref={profileSectionRef}>
                                <Card.Body>
                                    <div className="org-top">
                                        <div
                                            className={`org-avatar ${employerProfile?.logo_url ? "with-logo" : ""}`}
                                            style={employerProfile?.logo_url ? { backgroundImage: `url(${employerProfile.logo_url})` } : undefined}
                                            aria-label="Organization avatar"
                                        >
                                            {!employerProfile?.logo_url && (orgName[0]?.toUpperCase() || "O")}
                                        </div>
                                        <div>
                                            <h4>{orgName}</h4>
                                            <p>{industryValue || industry}</p>
                                        </div>
                                        <span className={`verify-badge ${isVerified ? "ok" : "pending"}`}>
                                            {isVerified ? "Verified" : "Pending Verification"}
                                        </span>
                                    </div>

                                    <div className="industry-edit-row">
                                        <Form.Group className="industry-field">
                                            <Form.Label>Industry</Form.Label>
                                            <Form.Control
                                                type="text"
                                                value={industryValue}
                                                onChange={(e) => setIndustryValue(e.target.value)}
                                                placeholder="e.g. Information Technology"
                                            />
                                        </Form.Group>
                                        <Button
                                            variant="outline-success"
                                            className="industry-save-btn"
                                            onClick={handleIndustrySave}
                                            disabled={industrySaving}
                                        >
                                            {industrySaving ? "Saving..." : "Save Industry"}
                                        </Button>
                                    </div>

                                    <div className="logo-uploader">
                                        <label>Government/Business Logo</label>
                                        <div className="logo-upload-row">
                                            <Form.Control
                                                type="file"
                                                accept="image/*"
                                                onChange={(e) => setLogoFile(e.target.files?.[0] || null)}
                                            />
                                            <Button
                                                variant="outline-success"
                                                onClick={handleLogoUpload}
                                                disabled={logoSaving}
                                            >
                                                {logoSaving ? "Saving..." : "Upload"}
                                            </Button>
                                        </div>
                                    </div>

                                    <div className="org-info-grid">
                                        <div><span>Contact Email</span><p>{contactEmail}</p></div>
                                        <div><span>Address</span><p>{address}</p></div>
                                        <div><span>Total Job Posts</span><p>{employerJobs.length}</p></div>
                                        <div><span>Role</span><p>{profile?.role || "Employer"}</p></div>
                                    </div>
                                </Card.Body>
                            </Card>
                        </div>
                    )}

                    {activeView === "post_job" && (
                        <div className="employer-job-management-grid employer-job-posting-grid">
                            <div className="employer-post-job-panel">
                                <Card className="employer-card">
                                    <Card.Body>
                                        <JobPostingForm
                                            value={form}
                                            onChange={setForm}
                                            profile={profile || user}
                                            requirements={requirements}
                                            requirementsEditor={renderRequirementFields()}
                                            submitting={submitting}
                                            onPublish={handleCreateJob}
                                        />
                                    </Card.Body>
                                </Card>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <Modal
                show={!!selectedApplication}
                onHide={() => {
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

                            const toFileUrl = (filePath) => {
                                if (!filePath) return "";
                                if (filePath.startsWith("data:") || filePath.startsWith("http://") || filePath.startsWith("https://")) return filePath;
                                const baseUrl = API_BASE_URL.replace(/\/api$/, "");
                                if (filePath.startsWith("/api/")) return `${baseUrl}${filePath}`;
                                if (filePath.startsWith("/uploads/")) return `${baseUrl}${filePath}`;
                                return filePath;
                            };

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
                                                                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                                                            <button
                                                                                type="button"
                                                                                className="emp-view-btn"
                                                                                onClick={() => previewDocumentFile(doc, app.id)}
                                                                                style={{ padding: "4px 8px", minWidth: 0 }}
                                                                            >
                                                                                View
                                                                            </button>
                                                                            <button type="button" className="applicant-document-download" onClick={() => downloadApplicationDocument(doc, app.id)}>
                                                                                Download
                                                                            </button>
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
                                                                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                                                            <button
                                                                                type="button"
                                                                                className="emp-view-btn"
                                                                                onClick={() => previewDocumentFile(doc, app.id)}
                                                                                style={{ padding: "4px 8px", minWidth: 0 }}
                                                                            >
                                                                                View
                                                                            </button>
                                                                            <button type="button" className="applicant-document-download" onClick={() => downloadApplicationDocument(doc, app.id)}>
                                                                                Download
                                                                            </button>
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
                </Modal.Body>

                <Modal.Footer className="applicant-modal-footer">
                    <Button
                        variant="outline-dark"
                        onClick={handlePrintApplication}
                        disabled={!selectedApplication}
                    >
                        Print Application
                    </Button>
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
                                onError={() => {
                                    setPreviewDocumentError("The uploaded image could not be displayed. Try downloading the file.");
                                    setPreviewDocument(null);
                                }}
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
                    {previewDocument && (
                        <Button variant="primary" onClick={downloadPreviewDocument}>Download</Button>
                    )}
                </Modal.Footer>
            </Modal>

            <InterviewDetailsModal
                show={interviewDetailsModalOpen}
                onHide={() => setInterviewDetailsModalOpen(false)}
                jobTitle={interviewDetailsJob?.title}
                values={interviewDetailsDraft}
                onChange={(key, value) => setInterviewDetailsDraft((previous) => ({ ...previous, [key]: value }))}
                onSave={saveInterviewDetails}
                mode={interviewDetailsMode}
                configured={interviewDetailsConfigured}
                loading={interviewDetailsLoading}
                saving={interviewDetailsSaving}
                loadError={interviewDetailsLoadError}
                saveError={interviewDetailsSaveError}
                onRetry={interviewDetailsJob ? () => openJobInterviewDetails(interviewDetailsJob) : undefined}
            />

            <Modal
                show={stopConfirm.open}
                onHide={closeStopConfirm}
                centered
            >
                <Modal.Header closeButton>
                    <Modal.Title>Stop Recruitment</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    Are you sure you want to stop recruitment for this job? New alumni will no longer be able to apply.
                </Modal.Body>
                <Modal.Footer>
                    <Button variant="outline-secondary" onClick={closeStopConfirm} disabled={reviewing}>
                        Cancel
                    </Button>
                    <Button variant="danger" onClick={confirmStopRecruitment} disabled={reviewing}>
                        Stop Recruitment
                    </Button>
                </Modal.Footer>
            </Modal>

            <Modal
                show={showProfileModal}
                onHide={() => {
                    setShowProfileModal(false);
                    setSelectedProfile(null);
                }}
                centered
            >
                <Modal.Header closeButton>
                    <Modal.Title>User Profile</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    {profileLoading && (
                        <div className="text-muted mb-0">
                            <Spinner animation="border" size="sm" /> Loading profile...
                        </div>
                    )}
                    {!profileLoading && selectedProfile && (
                        <div className="profile-modal">
                            <div className="profile-modal-avatar">
                                {renderAvatar({
                                    name: selectedProfile.name,
                                    admin_avatar_url: selectedProfile.admin_avatar_url,
                                    avatar_url:
                                        selectedProfile.AlumniProfile?.avatar_url ||
                                        selectedProfile.EmployerProfile?.logo_url
                                })}
                            </div>
                            <h4>{selectedProfile.name}</h4>
                            <p>{selectedProfile.role}</p>
                            {selectedProfile.role === "admin" && (
                                <p>Office / Department: {selectedProfile.admin_department || "N/A"}</p>
                            )}
                            {selectedProfile.AlumniProfile?.course && (
                                <p>Course: {selectedProfile.AlumniProfile.course}</p>
                            )}
                            {selectedProfile.AlumniProfile?.graduation_year && (
                                <p>Batch Year: {selectedProfile.AlumniProfile.graduation_year}</p>
                            )}
                            {selectedProfile.EmployerProfile?.organization_name && (
                                <p>Organization: {selectedProfile.EmployerProfile.organization_name}</p>
                            )}
                            <p>
                                Visibility:{" "}
                                {selectedProfile.AlumniProfile?.profile_visibility || "public"}
                            </p>
                        </div>
                    )}
                </Modal.Body>
            </Modal>
        </>
    );
}
