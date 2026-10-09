import React, { useState, useEffect } from "react";
import { Modal, Button, Form, Alert, Spinner } from "react-bootstrap";
import { api } from "../services/api";
import "./JobApplicationModal.css";

export default function JobApplicationModal({ show, onHide, job, onSubmitted }) {
    const [requirements, setRequirements] = useState([]);
    const [requirementFiles, setRequirementFiles] = useState({});
    const [form, setForm] = useState({});
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");
    const [resumes, setResumes] = useState([]);
    const [selectedResumeId, setSelectedResumeId] = useState("");
    const [uploadedResume, setUploadedResume] = useState(null);
    const [resumeMode, setResumeMode] = useState("upload");
    const [loadingResumes, setLoadingResumes] = useState(false);

    // Load dynamic requirements on mount when job changes
    React.useEffect(() => {
        const loadRequirements = async () => {
            if (!job?.id) {
                setRequirements([]);
                return;
            }

            try {
                setSubmitting(false);
                setError("");
                const data = await api.get(`/jobs/${job.id}/requirements`);
                if (data.version && data.version > 0 && Array.isArray(data.requirements)) {
                    setRequirements(data.requirements);
                } else {
                    setRequirements([]);
                }
            } catch {
                setRequirements([]);
            }
        };

        loadRequirements();
    }, [job?.id]);

    const handleRequirementFileChange = (code, file) => {
        setRequirementFiles((prev) => ({ ...prev, [code]: file }));
    };

    const handleResumeFileChange = (e) => {
        const file = e.target.files?.[0] || null;
        setUploadedResume(file);
    };

    const resetState = () => {
        setForm({});
        setRequirementFiles({});
        setError("");
        setSelectedResumeId("");
        setUploadedResume(null);
        setResumes([]);
        setResumeMode("upload");
    };

    const isFormComplete = React.useMemo(() => {
        const requiredFields = requirements.filter(req => req.required);
        return requiredFields.every(req => {
            // Special-case Resume requirement: check selected resume or uploaded resume
            if (req.requirement_code === "resume") {
                if (resumeMode === "upload") {
                    return uploadedResume != null;
                }
                return !!selectedResumeId;
            }
            if (req.requirement_type === "document_upload") {
                return requirementFiles[req.requirement_code] != null;
            } else {
                const fieldName = `requirement_${req.requirement_code}`;
                const value = form[fieldName];
                return value && String(value).trim();
            }
        });
    }, [requirements, form, requirementFiles, resumeMode, uploadedResume, selectedResumeId]);

    const loadResumes = async () => {
        if (!job?.id) return;
        try {
            setLoadingResumes(true);
            const response = await api.get("/resumes");
            const resumeList = response.data.data || [];
            setResumes(resumeList);
            if (resumeList.length > 0) {
                setSelectedResumeId(resumeList[0].id);
            }
        } catch {
            // ignore
        } finally {
            setLoadingResumes(false);
        }
    };

    useEffect(() => {
        if (show) {
            // Load resume list only when the employer's requirements include a Resume requirement
            const hasResumeRequirement = requirements.some(r => r.requirement_code === "resume");
            if (hasResumeRequirement) {
                loadResumes();
            }
        } else {
            resetState();
        }
    }, [show, requirements]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError("");

        const hasResumeRequirement = requirements.some(r => r.requirement_code === "resume");

        if (hasResumeRequirement) {
            if (resumeMode === "resume-builder" && !selectedResumeId) {
                setError("Please select a resume from Resume Builder.");
                return;
            }

            if (resumeMode === "upload" && !uploadedResume) {
                setError("Please upload a resume.");
                return;
            }
        }

        if (!isFormComplete) {
            setError("Please complete all required information before submitting your application.");
            return;
        }

        setSubmitting(true);

        try {
            const formData = new FormData();
            formData.append("job_id", job?.id);

            if (hasResumeRequirement) {
                if (resumeMode === "upload") {
                    formData.append("resume", uploadedResume);
                } else if (resumeMode === "resume-builder") {
                    formData.append("resume_id", selectedResumeId);
                }
            }

            // Append dynamic requirement files and fields
            Object.entries(requirementFiles).forEach(([code, file]) => {
                if (file) {
                    formData.append(`requirement_${code}`, file);
                }
            });

            requirements.forEach((req) => {
                const fieldName = `requirement_${req.requirement_code}`;
                const value = form[fieldName];
                if (value && req.requirement_type === "information_field") {
                    formData.append(fieldName, value);
                }
            });

            await api.post("/applications", formData, true);
            resetState();
            onSubmitted?.();
            onHide?.();
        } catch (err) {
            setError(err.message);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Modal show={show} onHide={onHide} size="lg" centered scrollable dialogClassName="job-application-modal">
            <Modal.Header closeButton>
                <Modal.Title>Apply for {job?.title || "Job"}</Modal.Title>
            </Modal.Header>
            <Modal.Body>
                {error && <div className="alert alert-danger">{error}</div>}
                <Form onSubmit={handleSubmit}>
                    <Alert variant="info" className="mb-3">
                        Please submit the documents and information requested by the employer below. Incomplete applications will not be accepted.
                    </Alert>

                    {requirements.length === 0 && !submitting && (
                        <p className="text-muted">No application requirements defined for this job.</p>
                    )}
                    {requirements.map((req, idx) => (
                        <div key={req.requirement_code || idx} className="mb-3 p-3 border rounded">
                            <Form.Label className="fw-bold">
                                {req.label}
                                {req.required && <span className="text-danger ms-1">*</span>}
                            </Form.Label>
                            {req.description && (
                                <p className="text-muted small mb-2">{req.description}</p>
                            )}
                            {req.requirement_type === "document_upload" ? (
                                // Special handling for Resume requirement: offer Upload vs Resume Builder choices
                                req.requirement_code === "resume" ? (
                                    <div className="resume-selection">
                                        <div className="form-check">
                                            <input
                                                className="form-check-input"
                                                type="radio"
                                                name={`resumeMode_${req.requirement_code}`}
                                                id={`resumeModeUpload_${req.requirement_code}`}
                                                value="upload"
                                                checked={resumeMode === "upload"}
                                                onChange={(e) => setResumeMode(e.target.value)}
                                            />
                                            <label className="form-check-label" htmlFor={`resumeModeUpload_${req.requirement_code}`}>
                                                Upload Another Resume
                                            </label>
                                        </div>
                                        {resumeMode === "upload" && (
                                            <Form.Group controlId={`resumeUpload_${req.requirement_code}`} className="ms-4 mt-2">
                                                <Form.Control
                                                    type="file"
                                                    accept=".pdf"
                                                    onChange={handleResumeFileChange}
                                                    required={req.required && resumeMode === "upload"}
                                                />
                                                {uploadedResume && (
                                                    <div className="small text-success mt-1">Selected: {uploadedResume.name}</div>
                                                )}
                                            </Form.Group>
                                        )}

                                        <div className="form-check mt-2">
                                            <input
                                                className="form-check-input"
                                                type="radio"
                                                name={`resumeMode_${req.requirement_code}`}
                                                id={`resumeModeBuilder_${req.requirement_code}`}
                                                value="resume-builder"
                                                checked={resumeMode === "resume-builder"}
                                                onChange={(e) => setResumeMode(e.target.value)}
                                            />
                                            <label className="form-check-label" htmlFor={`resumeModeBuilder_${req.requirement_code}`}>
                                                Use Resume Builder Resume
                                            </label>
                                        </div>
                                        {resumeMode === "resume-builder" && (
                                            <div className="ms-4 mt-2">
                                                {loadingResumes ? (
                                                    <div className="d-flex align-items-center gap-2">
                                                        <Spinner animation="border" size="sm" />
                                                        <span className="text-muted small">Loading resumes...</span>
                                                    </div>
                                                ) : resumes.length === 0 ? (
                                                    <Alert variant="warning" className="py-2 small">No resumes found. Create one in Resume Builder first.</Alert>
                                                ) : (
                                                    <Form.Select
                                                        value={selectedResumeId}
                                                        onChange={(e) => setSelectedResumeId(e.target.value)}
                                                        required={req.required && resumeMode === "resume-builder"}
                                                    >
                                                        {resumes.map((resume) => (
                                                            <option key={resume.id} value={resume.id}>
                                                                {resume.personalInfo?.full_name || resume.title} {resume.is_default ? "(Default)" : ""}
                                                            </option>
                                                        ))}
                                                    </Form.Select>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <Form.Group controlId={`requirement_${req.requirement_code}`}>
                                        <Form.Control
                                            type="file"
                                            onChange={(e) => handleRequirementFileChange(req.requirement_code, e.target.files?.[0] || null)}
                                        />
                                        {req.allowed_types && (
                                            <Form.Text className="text-muted">Allowed: {req.allowed_types}</Form.Text>
                                        )}
                                        {requirementFiles[req.requirement_code] && (
                                            <div className="small text-success mt-1">
                                                Selected: {requirementFiles[req.requirement_code].name}
                                            </div>
                                        )}
                                    </Form.Group>
                                )
                            ) : (
                                <Form.Group controlId={`requirement_${req.requirement_code}`}>
                                    <Form.Control
                                        type={req.value_type === "textarea" ? "textarea" : req.value_type === "number" ? "number" : req.value_type === "date" ? "date" : "text"}
                                        rows={req.value_type === "textarea" ? 3 : undefined}
                                        placeholder={req.description || `Enter ${req.label}`}
                                        onChange={(e) => setForm((prev) => ({ ...prev, [`requirement_${req.requirement_code}`]: e.target.value }))}
                                    />
                                </Form.Group>
                            )}
                        </div>
                    ))}
                    <div className="job-application-actions">
                        <Button variant="secondary" onClick={onHide} disabled={submitting}>
                            Cancel
                        </Button>
                        <Button type="submit" variant="success" disabled={submitting || !isFormComplete || requirements.length === 0}>
                            {submitting ? "Submitting..." : "Submit Application"}
                        </Button>
                    </div>
                </Form>
            </Modal.Body>
        </Modal>
    );
}