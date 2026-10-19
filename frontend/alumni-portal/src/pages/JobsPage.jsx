import React, { useEffect, useMemo, useState } from "react";
import { Card, Button, Form, Modal } from "react-bootstrap";
import "../pages/JobPage.css";
import { api, API_BASE_URL } from "../services/api";
import useRenderDebug from "../hooks/useRenderDebug";
import useStrictSafeEffect from "../hooks/useStrictSafeEffect";
import { FiCheck, FiFilter, FiMapPin, FiSearch } from "react-icons/fi";
import { BsBuilding } from "react-icons/bs";
import JobApplicationModal from "../components/JobApplicationModal";
import RegistrationSuccessToast from "../components/RegistrationSuccessToast";
import JobPostingAdvertisement from "../components/jobs/JobPostingAdvertisement";
import { getJobCompanyName, getJobPostingMeta } from "../utils/jobDisplay";
import { APPLICATION_SUCCESS_MESSAGE, APPLICATION_SUCCESS_TITLE, APPLICATION_TOAST_DELAY } from "../utils/jobApplicationSubmission";
import { useNavigate, useSearchParams } from "react-router-dom";
import { EMPLOYMENT_TYPE_OPTIONS, getEmploymentTypeLabel, normalizeEmploymentType } from "../utils/employmentTypes";

export default function JobsPage() {
    useRenderDebug("JobsPage");
    const [jobs, setJobs] = useState([]);
    const [appliedJobIds, setAppliedJobIds] = useState([]);
    const [search, setSearch] = useState("");
    const [typeFilter, setTypeFilter] = useState("all");
    const [locationFilter, setLocationFilter] = useState("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [actionMessage, setActionMessage] = useState("");
    const [applicationNotice, setApplicationNotice] = useState(null);
    const [showPreviewModal, setShowPreviewModal] = useState(false);
    const [showModal, setShowModal] = useState(false);
    const [selectedJob, setSelectedJob] = useState(null);
    const [selectedJobError, setSelectedJobError] = useState("");
    const [brokenAuthorImages, setBrokenAuthorImages] = useState({});
    const [previewRequirements, setPreviewRequirements] = useState([]);
    const [requirementsLoading, setRequirementsLoading] = useState(false);
    const [requirementsError, setRequirementsError] = useState("");
    const [requirementsAttempt, setRequirementsAttempt] = useState(0);
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const requestedJobId = searchParams.get("jobId");

    useEffect(() => {
        if (!applicationNotice) return;
        const timer = window.setTimeout(() => setApplicationNotice(null), APPLICATION_TOAST_DELAY);
        return () => window.clearTimeout(timer);
    }, [applicationNotice]);

    const currentUser = useMemo(() => {
        try {
            return JSON.parse(localStorage.getItem("user") || "null");
        } catch {
            return null;
        }
    }, []);

    useStrictSafeEffect(
        "JobsPage:init",
        () => {
            const loadJobs = async () => {
                try {
                    const data = await api.get("/jobs");
                    setJobs(Array.isArray(data) ? data : []);

                    try {
                        const applications = await api.get("/applications", true);
                        const ids = (Array.isArray(applications) ? applications : []).map((a) => a.job_id);
                        setAppliedJobIds(ids);
                    } catch {
                        setAppliedJobIds([]);
                    }
                } catch (err) {
                    setError(err.message);
                } finally {
                    setLoading(false);
                }
            };

            loadJobs();
            return undefined;
        },
        [],
        { label: "JobsPage init" }
    );

    useEffect(() => {
        if (!requestedJobId || loading) return;
        const job = jobs.find((item) => String(item.id) === requestedJobId);
        if (!job) {
            setSelectedJob(null);
            setShowPreviewModal(false);
            setSelectedJobError("That job is unavailable or may have been removed. You can continue browsing the job list.");
            return;
        }
        setSelectedJobError("");
        handleOpenJobDetails(job);
    }, [requestedJobId, loading, jobs]);

    useEffect(() => {
        let cancelled = false;

        if (!showPreviewModal || !selectedJob?.id) return;
        api.get(`/jobs/${selectedJob.id}/requirements`).then(data => {
            if (!Array.isArray(data?.requirements)) throw new Error("Application requirements could not be loaded.");
            if (!cancelled) setPreviewRequirements(data.requirements);
        }).catch(failure => {
            if (!cancelled) setRequirementsError(failure.message || "Application requirements could not be loaded.");
        }).finally(() => { if (!cancelled) setRequirementsLoading(false); });

        return () => {
            cancelled = true;
        };
    }, [showPreviewModal, selectedJob?.id, requirementsAttempt]);

    const filteredJobs = useMemo(() => {
        return jobs.filter((job) => {
            const text = `${job.title || ""} ${getJobCompanyName(job)} ${job.User?.name || ""}`.toLowerCase();
            const location = (job.location || "").toLowerCase();
            const searchMatch = text.includes(search.toLowerCase());
            const locationMatch = location.includes(locationFilter.toLowerCase());
            const typeMatch = typeFilter === "all" || normalizeEmploymentType(job.employment_type) === typeFilter;
            return searchMatch && locationMatch && typeMatch;
        });
    }, [jobs, search, locationFilter, typeFilter]);

    const handleOpenJobDetails = (job) => {
        setSelectedJob(job);
        setPreviewRequirements([]);
        setRequirementsLoading(true);
        setRequirementsError("");
        setShowPreviewModal(true);
    };

    const closeJobDetails = () => {
        setShowPreviewModal(false);
        if (searchParams.has("jobId")) {
            const next = new URLSearchParams(searchParams);
            next.delete("jobId");
            setSearchParams(next, { replace: true });
        }
    };

    const handleOpenApply = (job) => {
        if (!currentUser) {
            setActionMessage("Please log in as an alumni to apply.");
            navigate("/login");
            return;
        }

        if (currentUser.role !== "alumni") {
            setActionMessage("Only alumni accounts can apply for jobs.");
            return;
        }

        handleOpenJobDetails(job);
    };

    const handleStartApplication = () => {
        if (requirementsLoading || requirementsError || appliedJobIds.includes(selectedJob?.id)) return;
        if (!currentUser) { navigate("/login"); return; }
        if (currentUser.role !== "alumni") { setActionMessage("Only alumni accounts can apply for jobs."); return; }
        setShowPreviewModal(false);
        setShowModal(true);
    };

    const handleCloseApplication = () => {
        setShowModal(false);
        setShowPreviewModal(false);
    };

    const handleSubmitted = (application) => {
        setAppliedJobIds((prev) => [...new Set([...prev, Number(application.job_id)])]);
        setActionMessage("");
        setApplicationNotice({ variant: "success", title: APPLICATION_SUCCESS_TITLE, message: APPLICATION_SUCCESS_MESSAGE });
    };

    const handleSubmissionError = (failure) => {
        setApplicationNotice({
            variant: "error",
            title: "Application Could Not Be Submitted",
            message: failure?.message || "Your application could not be submitted. Please try again.",
        });
    };

    const getJobType = (job) => {
        return getEmploymentTypeLabel(job?.employment_type, "Full-Time");
    };

    const truncate = (value, size = 140) => {
        const str = value || "";
        if (str.length <= size) return str;
        return `${str.slice(0, size).trim()}...`;
    };

    const toAbsoluteUrl = (value) => {
        if (!value) return "";
        if (String(value).startsWith("data:")) return value;
        if (/^https?:\/\//i.test(value)) return value;
        const base = API_BASE_URL.replace(/\/api$/, "");
        return `${base}${value}`;
    };

    const getJobAuthor = (job) => job?.User || job?.user || job?.author || job?.employer || null;

    const getProfileImage = (profile) =>
        profile?.admin_avatar_url ||
        profile?.user?.admin_avatar_url ||
        profile?.EmployerProfile?.logo_url ||
        profile?.user?.EmployerProfile?.logo_url ||
        profile?.AlumniProfile?.avatar_url ||
        profile?.user?.AlumniProfile?.avatar_url ||
        "";

    const getExpectedSalary = (job) =>
        job?.expected_salary ||
        job?.expectedSalary ||
        job?.salary ||
        job?.Job?.expected_salary ||
        job?.Job?.expectedSalary ||
        "";

    const getJobAuthorImage = (job) => {
        const author = getJobAuthor(job);
        if (brokenAuthorImages[author?.id || job?.id]) return "";

        return toAbsoluteUrl(
            getProfileImage(author) ||
            ""
        );
    };

    const handleJobAuthorImageError = (job) => {
        const author = getJobAuthor(job);
        const key = author?.id || job?.id;
        if (!key) return;

        setBrokenAuthorImages((prev) => (prev[key] ? prev : { ...prev, [key]: true }));
    };

    return (
        <div className="jobs-page">
            <div className="jobs-header">
                <h2 className="jobs-title">Job Portal</h2>
                <p className="jobs-subtitle">Find opportunities that match your skills and career goals.</p>
            </div>

            <div className="jobs-filters">
                <div className="filter-input with-icon">
                    <FiSearch />
                    <Form.Control
                        type="text"
                        placeholder="Search jobs or companies..."
                        className="job-search"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>

                <button type="button" className="filter-icon-btn" title="Advanced Filters">
                    <FiFilter />
                </button>

                <div className="filter-input select-wrap">
                    <Form.Select
                        className="job-filter"
                        value={typeFilter}
                        onChange={(e) => setTypeFilter(e.target.value)}
                    >
                        <option value="all">All Employment Types</option>
                        {EMPLOYMENT_TYPE_OPTIONS.map(({ value, label }) => (
                            <option key={value} value={value}>{label}</option>
                        ))}
                    </Form.Select>
                </div>

                <div className="filter-input with-icon">
                    <FiMapPin />
                    <Form.Control
                        type="text"
                        placeholder="Filter by location..."
                        className="job-location"
                        value={locationFilter}
                        onChange={(e) => setLocationFilter(e.target.value)}
                    />
                </div>
            </div>

            <div className="jobs-grid">
                {loading && <p>Loading jobs...</p>}
                {error && <p>{error}</p>}
                {!loading && !error && filteredJobs.length === 0 && <p>No jobs found.</p>}

                {filteredJobs.map((job) => (
                    <Card className="job-card" key={job.id}>
                        <Card.Body>
                            <div className="job-header">
                                <div className="job-logo">
                                    {getJobAuthorImage(job) ? (
                                        <img
                                            src={getJobAuthorImage(job)}
                                            alt={`${getJobAuthor(job)?.name || "Employer"} logo`}
                                            className="job-logo-img"
                                            onError={() => handleJobAuthorImageError(job)}
                                        />
                                    ) : (
                                        <BsBuilding />
                                    )}
                                </div>

                                <div>
                                    <h5 className="job-title">{job.title}</h5>
                                    <p className="job-company">{getJobCompanyName(job)}</p>
                                </div>
                            </div>

                            <div className="job-tags">
                                <span className="job-type fulltime">{getJobType(job)}</span>
                                {getJobPostingMeta(job).workSetup && <span className="job-type fulltime">{getJobPostingMeta(job).workSetup}</span>}
                                {getJobPostingMeta(job).vacancies && <span className="job-type fulltime">{getJobPostingMeta(job).vacancies} {getJobPostingMeta(job).vacancies === 1 ? "vacancy" : "vacancies"}</span>}
                            </div>

                            <p className="job-required">
                                <span>Qualification:</span> {job.course_target || "Any relevant degree"}
                            </p>
                            <p className="job-required">
                                <span>Expected Salary:</span> {getExpectedSalary(job) || "Not specified"}
                            </p>
                            <p className="job-location-text">
                                <FiMapPin /> {job.location || "Not specified"}
                            </p>
                            <p className="job-desc">{truncate(job.description || "No description provided.")}</p>

                            <div className="job-card-actions">
                            {appliedJobIds.includes(job.id) ? (
                                <Button className="apply-btn applied-btn" disabled>
                                    <FiCheck /> Applied
                                </Button>
                            ) : (
                                <Button className="apply-btn" onClick={() => handleOpenApply(job)}>
                                    Apply Now
                                </Button>
                            )}
                            </div>
                        </Card.Body>
                    </Card>
                ))}
            </div>

            {selectedJobError && (
                <div className="alert alert-warning" role="status">
                    {selectedJobError} <Button variant="outline-secondary" size="sm" onClick={() => { setSelectedJobError(""); closeJobDetails(); }}>Return to job list</Button>
                </div>
            )}

            {actionMessage && <p>{actionMessage}</p>}

            <JobApplicationModal
                show={showModal}
                onHide={handleCloseApplication}
                job={selectedJob}
                onSubmitted={handleSubmitted}
                onSubmissionError={handleSubmissionError}
            />

            <RegistrationSuccessToast
                show={Boolean(applicationNotice)}
                variant={applicationNotice?.variant}
                title={applicationNotice?.title}
                message={applicationNotice?.message}
                positionerClassName="jobs-application-toast"
                onClose={() => setApplicationNotice(null)}
            />

            <Modal
                show={showPreviewModal}
                onHide={closeJobDetails}
                centered
                size="lg"
                dialogClassName="job-preview-dialog"
                contentClassName="job-preview-content"
            >
                <Modal.Header closeButton className="job-preview-header">
                    <div>
                        <Modal.Title>{selectedJob?.title || "Job Details"}</Modal.Title>
                        <p className="job-preview-company">{getJobCompanyName(selectedJob)}</p>
                    </div>
                </Modal.Header>
                <Modal.Body className="job-preview-body">
                    <JobPostingAdvertisement job={selectedJob} requirements={previewRequirements} companyName={getJobCompanyName(selectedJob)} />
                    {requirementsLoading && <p role="status">Loading application requirements…</p>}
                    {requirementsError && <div className="alert alert-danger" role="alert">{requirementsError} <Button variant="outline-danger" size="sm" onClick={() => { setRequirementsError(""); setRequirementsLoading(true); setRequirementsAttempt(value => value + 1); }}>Retry</Button></div>}
                </Modal.Body>
                <Modal.Footer className="job-preview-footer">
                    <Button variant="outline-secondary" onClick={closeJobDetails}>
                        Close
                    </Button>
                    <Button className="job-preview-apply" disabled={requirementsLoading || Boolean(requirementsError) || appliedJobIds.includes(selectedJob?.id)} onClick={handleStartApplication}>
                        {appliedJobIds.includes(selectedJob?.id) ? "Applied" : "Apply Now"}
                    </Button>
                </Modal.Footer>
            </Modal>
        </div>
    );
}


