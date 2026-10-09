import React, { useEffect, useMemo, useState } from "react";
import { Card, Button, Form, Modal } from "react-bootstrap";
import "../pages/JobPage.css";
import { api, API_BASE_URL } from "../services/api";
import useRenderDebug from "../hooks/useRenderDebug";
import useStrictSafeEffect from "../hooks/useStrictSafeEffect";
import { FiCheck, FiFilter, FiMapPin, FiSearch } from "react-icons/fi";
import { BsBuilding } from "react-icons/bs";
import JobApplicationModal from "../components/JobApplicationModal";
import { useNavigate } from "react-router-dom";
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
    const [showPreviewModal, setShowPreviewModal] = useState(false);
    const [showModal, setShowModal] = useState(false);
    const [selectedJob, setSelectedJob] = useState(null);
    const [authorImages, setAuthorImages] = useState({});
    const [brokenAuthorImages, setBrokenAuthorImages] = useState({});
    const navigate = useNavigate();

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
        let cancelled = false;

        const hydrateAuthorImages = async () => {
            const missingImageJobs = jobs.filter((job) => {
                const author = getJobAuthor(job);
                return author?.id && !getProfileImage(author);
            });
            if (missingImageJobs.length === 0) return;

            try {
                const resolved = await Promise.all(
                    missingImageJobs.map(async (job) => {
                        try {
                            const author = getJobAuthor(job);
                            const profile = await api.get(`/profile/${author.id}`, true);
                            const image = getProfileImage(profile);
                            return image ? [author.id, image] : null;
                        } catch {
                            return null;
                        }
                    })
                );

                if (cancelled) return;

                setAuthorImages((prev) => {
                    const next = { ...prev };
                    resolved.forEach((entry) => {
                        if (!entry) return;
                        const [userId, image] = entry;
                        next[userId] = toAbsoluteUrl(image);
                    });
                    return next;
                });
            } catch {
                // keep the existing fallback icon if profile lookups fail
            }
        };

        hydrateAuthorImages();

        return () => {
            cancelled = true;
        };
    }, [jobs]);

    const filteredJobs = useMemo(() => {
        return jobs.filter((job) => {
            const text = `${job.title || ""} ${job.User?.name || ""}`.toLowerCase();
            const location = (job.location || "").toLowerCase();
            const searchMatch = text.includes(search.toLowerCase());
            const locationMatch = location.includes(locationFilter.toLowerCase());
            const typeMatch = typeFilter === "all" || normalizeEmploymentType(job.employment_type) === typeFilter;
            return searchMatch && locationMatch && typeMatch;
        });
    }, [jobs, search, locationFilter, typeFilter]);

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

        setSelectedJob(job);
        setShowPreviewModal(true);
    };

    const handleStartApplication = () => {
        setShowPreviewModal(false);
        setShowModal(true);
    };

    const handleCloseApplication = () => {
        setShowModal(false);
        setShowPreviewModal(false);
    };

    const handleSubmitted = (jobId) => {
        setAppliedJobIds((prev) => [...new Set([...prev, jobId])]);
        setActionMessage("Application submitted.");
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
            authorImages[author?.id] ||
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
                                    <p className="job-company">{getJobAuthor(job)?.name || "Employer"}</p>
                                </div>
                            </div>

                            <div className="job-tags">
                                <span className="job-type fulltime">{getJobType(job)}</span>
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

                            {appliedJobIds.includes(job.id) ? (
                                <Button className="apply-btn applied-btn" disabled>
                                    <FiCheck /> Applied
                                </Button>
                            ) : (
                                <Button className="apply-btn" onClick={() => handleOpenApply(job)}>
                                    Apply Now
                                </Button>
                            )}
                        </Card.Body>
                    </Card>
                ))}
            </div>

            {actionMessage && <p>{actionMessage}</p>}

            <JobApplicationModal
                show={showModal}
                onHide={handleCloseApplication}
                job={selectedJob}
                onSubmitted={() => handleSubmitted(selectedJob?.id)}
            />

            <Modal
                show={showPreviewModal}
                onHide={() => setShowPreviewModal(false)}
                centered
                size="lg"
                dialogClassName="job-preview-dialog"
                contentClassName="job-preview-content"
            >
                <Modal.Header closeButton className="job-preview-header">
                    <div>
                        <Modal.Title>{selectedJob?.title || "Job Details"}</Modal.Title>
                        <p className="job-preview-company">{getJobAuthor(selectedJob)?.name || "Employer"}</p>
                    </div>
                </Modal.Header>
                <Modal.Body className="job-preview-body">
                    <div className="job-preview-grid">
                        <div className="job-preview-block">
                            <span>Job Title</span>
                            <strong>{selectedJob?.title || "N/A"}</strong>
                        </div>
                        <div className="job-preview-block">
                            <span>Employment Type</span>
                            <strong>{selectedJob ? getJobType(selectedJob) : "N/A"}</strong>
                        </div>
                        <div className="job-preview-block job-preview-block-wide">
                            <span>Qualification</span>
                            <strong>{selectedJob?.course_target || "Any relevant degree"}</strong>
                        </div>
                        <div className="job-preview-block job-preview-block-wide">
                            <span>Expected Salary</span>
                            <strong>{getExpectedSalary(selectedJob) || "Not specified"}</strong>
                        </div>
                        <div className="job-preview-block job-preview-block-wide">
                            <span>Location</span>
                            <strong>{selectedJob?.location || "Not specified"}</strong>
                        </div>
                        <div className="job-preview-block job-preview-block-wide">
                            <span>Description</span>
                            <p>{selectedJob?.description || "No description provided."}</p>
                        </div>
                    </div>
                </Modal.Body>
                <Modal.Footer className="job-preview-footer">
                    <Button variant="outline-secondary" onClick={() => setShowPreviewModal(false)}>
                        Close
                    </Button>
                    <Button className="job-preview-apply" onClick={handleStartApplication}>
                        Apply Now
                    </Button>
                </Modal.Footer>
            </Modal>
        </div>
    );
}


