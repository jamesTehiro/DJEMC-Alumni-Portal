import React, { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button, Form, Row, Col } from "react-bootstrap";
import { api } from "../../services/api";
import useRenderDebug from "../../hooks/useRenderDebug";
import useStrictSafeEffect from "../../hooks/useStrictSafeEffect";
import AdminShell from "../../components/AdminShell";
import SectionHeader from "../../components/ui/SectionHeader";
import { ADMIN_SCOPE_META, clearSessionAndGoHome, getStoredUser, isAllowedAdminScope } from "./adminUtils";
import { EMPLOYMENT_TYPE_OPTIONS } from "../../utils/employmentTypes";
import "../AdminEmployerPage.css";

export default function AdminModerationPage({ role }) {
    useRenderDebug(`AdminModerationPage:${role}`);
    const navigate = useNavigate();
    // ── Jobs state ──
    const [jobs, setJobs] = useState([]);
    const [announcements, setAnnouncements] = useState([]);
    const [announcement, setAnnouncement] = useState({
        title: "",
        content: "",
        targetYear: "",
        day: "",
        time: "",
        location: ""
    });
    const [message, setMessage] = useState("");
    const [error, setError] = useState("");

    // ── Post Job form state ──
    const [form, setForm] = useState({
        title: "",
        description: "",
        location: "",
        employment_type: "full-time",
        course_target: "",
        expected_salary: ""
    });
    const [requirements, setRequirements] = useState([]);
    const [submitting, setSubmitting] = useState(false);

    const user = useMemo(() => getStoredUser(), []);
    const isAllowed = isAllowedAdminScope(user, role);
    const scopeMeta = ADMIN_SCOPE_META[role];

    // ── Data loading ──
    const loadEmployerJobs = async () => {
        try {
            const data = await api.get("/admin/employer/jobs", true);
            setJobs(Array.isArray(data) ? data : []);
        } catch (err) {
            setError(err.message);
        }
    };

    const loadAlumniAnnouncements = async () => {
        try {
            const data = await api.get("/admin/alumni/announcements", true);
            setAnnouncements(Array.isArray(data) ? data : []);
        } catch (err) {
            setError(err.message);
        }
    };

    useStrictSafeEffect(
        `AdminModerationPage:init:${role}:${isAllowed}`,
        () => {
            if (!isAllowed) return undefined;
            if (role === "employer") {
                loadEmployerJobs();
                return undefined;
            }
            loadAlumniAnnouncements();
            return undefined;
        },
        [isAllowed, role],
        { label: `AdminModerationPage init (${role})` }
    );

    // ── Employer: Post Job helpers ──
    const handleChange = (e) => {
        setForm({ ...form, [e.target.name]: e.target.value });
    };

    const addRequirement = () => {
        setRequirements((prev) => [
            ...prev,
            {
                requirement_code: `custom_${Date.now()}`,
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
            next[index] = { ...next[index], [field]: value };
            return next;
        });
    };

    const removeRequirement = (index) => {
        setRequirements((prev) => {
            const next = prev.filter((_, i) => i !== index);
            return next.map((r, i) => ({ ...r, sort_order: i }));
        });
    };

    const handleCreateJob = async (e) => {
        e.preventDefault();
        setMessage("");
        setError("");

        if (!form.title || !form.location || !form.expected_salary) {
            setError("Title, location, and expected salary are required.");
            return;
        }

        if (requirements.length === 0) {
            setError("Please add at least one application requirement before publishing.");
            return;
        }

        setSubmitting(true);
        try {
            const payload = {
                title: form.title,
                description: form.description,
                location: form.location,
                employment_type: form.employment_type,
                course_target: form.course_target,
                expected_salary: form.expected_salary,
                requirements: requirements.map((r) => ({
                    requirement_code: r.requirement_code,
                    label: r.label,
                    requirement_type: r.requirement_type,
                    value_type: r.value_type || (r.requirement_type === "information_field" ? "text" : "file"),
                    required: r.required,
                    is_custom: r.is_custom,
                    library_code: r.library_code,
                    allowed_types: r.allowed_types,
                    max_file_size: r.max_file_size,
                    sort_order: r.sort_order
                }))
            };

            const data = await api.post("/jobs", payload, true);
            setMessage("Job posted successfully.");
            setForm({
                title: "",
                description: "",
                location: "",
                employment_type: "full-time",
                course_target: "",
                expected_salary: ""
            });
            setRequirements([]);
            await loadEmployerJobs();
        } catch (err) {
            setError(err.message);
        } finally {
            setSubmitting(false);
        }
    };

    // ── Render helpers ──
    const renderTextInput = (label, name) => (
        <Form.Group className="mb-3">
            <Form.Label>{label}</Form.Label>
            <Form.Control name={name} value={form[name]} onChange={handleChange} required />
        </Form.Group>
    );

    const renderRequirementFields = () => (
        <div className="mt-3">
            <h6>Application Requirements</h6>
            <p className="text-muted small mb-3">Define what applicants must submit.</p>
            {requirements.map((req, idx) => (
                <div key={idx} className="border rounded p-3 mb-2">
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
                        <Col md={1}>
                            <Form.Group className="mb-0">
                                <Form.Check
                                    type="switch"
                                    label="Req"
                                    checked={req.required}
                                    onChange={(e) => updateRequirement(idx, "required", e.target.checked)}
                                />
                            </Form.Group>
                        </Col>
                        <Col md={1}>
                            <Button variant="outline-danger" size="sm" onClick={() => removeRequirement(idx)}>
                                ×
                            </Button>
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
            <div className="d-flex justify-content-start mt-2">
                <Button variant="outline-primary" size="sm" onClick={addRequirement}>
                    + Custom Requirement
                </Button>
            </div>
        </div>
    );

    const formatAnnouncementDate = (value) => {
        if (!value) return "To be announced";
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return value;
        return date.toLocaleDateString("en-US", {
            month: "long",
            day: "numeric",
            year: "numeric"
        });
    };

    const formatAnnouncementTime = (value) => {
        if (!value) return "To be announced";
        const [hours, minutes] = String(value).split(":");
        if (hours === undefined || minutes === undefined) return value;
        const date = new Date();
        date.setHours(Number(hours), Number(minutes), 0, 0);
        if (Number.isNaN(date.getTime())) return value;
        return date.toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit"
        });
    };

    const submitAnnouncement = async (event) => {
        event.preventDefault();
        setMessage("");
        setError("");
        try {
            await api.post(
                "/admin/alumni/announcements",
                {
                    title: announcement.title,
                    content: announcement.content,
                    target_year: announcement.targetYear || undefined,
                    day: announcement.day || undefined,
                    time: announcement.time || undefined,
                    location: announcement.location || undefined
                },
                true
            );
            setMessage("Announcement posted to verified alumni.");
            setAnnouncement({
                title: "",
                content: "",
                targetYear: "",
                day: "",
                time: "",
                location: ""
            });
            loadAlumniAnnouncements();
        } catch (err) {
            setError(err.message);
        }
    };

    const removeAnnouncement = async (id) => {
        setMessage("");
        setError("");
        try {
            await api.delete(`/admin/alumni/announcements/${id}`, true);
            setMessage("Announcement deleted.");
            loadAlumniAnnouncements();
        } catch (err) {
            setError(err.message);
        }
    };

    // ── Guard ──
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

    // ── Employer: Job Management view ──
    if (role === "employer") {
        return (
            <AdminShell
                scope={role}
                title="Job Management"
                subtitle="Post a new job and manage existing listings side by side."
                onLogout={() => clearSessionAndGoHome(navigate)}
            >
                {message && <p className="notice success">{message}</p>}
                {error && <p className="notice error">{error}</p>}

                <section className="content-grid-centered">
                    {/* ── Post a Job Form (centered) ── */}
                    <div className="queue-panel">
                        <SectionHeader title="Post a Job" meta="Create a new vacancy" />
                        <Form onSubmit={handleCreateJob}>
                            <Row>
                                <Col md={6}>{renderTextInput("Job Title", "title")}</Col>
                                <Col md={6}>{renderTextInput("Location", "location")}</Col>
                            </Row>
                            <Row>
                                <Col md={6}>
                                    <Form.Group className="mb-3">
                                        <Form.Label>Employment Type</Form.Label>
                                        <Form.Select name="employment_type" value={form.employment_type} onChange={handleChange} required>
                                            {EMPLOYMENT_TYPE_OPTIONS.map(({ value, label }) => (
                                                <option key={value} value={value}>{label}</option>
                                            ))}
                                        </Form.Select>
                                    </Form.Group>
                                </Col>
                                <Col md={6}>{renderTextInput("Expected Salary", "expected_salary")}</Col>
                            </Row>
                            <Form.Group className="mb-3">
                                <Form.Label>Description</Form.Label>
                                <Form.Control
                                    as="textarea"
                                    rows={3}
                                    name="description"
                                    value={form.description}
                                    onChange={handleChange}
                                    required
                                />
                            </Form.Group>
                            <Form.Group className="mb-3">
                                <Form.Label>Qualification</Form.Label>
                                <Form.Control name="course_target" value={form.course_target} onChange={handleChange} />
                            </Form.Group>

                            {renderRequirementFields()}

                            <div className="mt-4 d-flex justify-content-end gap-2">
                                <Button
                                    type="submit"
                                    className="primary-btn"
                                    disabled={submitting || requirements.length === 0}
                                >
                                    {submitting ? "Saving..." : "Publish Job"}
                                </Button>
                            </div>
                        </Form>
                    </div>
                </section>
            </AdminShell>
        );
    }

    // ── Alumni: Announcement page (unchanged) ──
    return (
        <AdminShell
            scope={role}
            title="Post Announcements"
            subtitle="Publish and manage official alumni announcements."
            onLogout={() => clearSessionAndGoHome(navigate)}
        >
            {message && <p className="notice success">{message}</p>}
            {error && <p className="notice error">{error}</p>}

            <section className="content-grid">
                <div className="queue-panel">
                    <SectionHeader title="Create Announcement" meta="Notify verified alumni" />
                    <form className="form-stack" onSubmit={submitAnnouncement}>
                        <label className="field">
                            <span>Title</span>
                            <input
                                className="saas-input"
                                value={announcement.title}
                                onChange={(event) => setAnnouncement((prev) => ({ ...prev, title: event.target.value }))}
                                required
                            />
                        </label>
                        <label className="field">
                            <span>Content</span>
                            <textarea
                                className="saas-textarea"
                                rows={4}
                                value={announcement.content}
                                onChange={(event) => setAnnouncement((prev) => ({ ...prev, content: event.target.value }))}
                                required
                            />
                        </label>
                        <label className="field">
                            <span>Target Graduation Year (optional)</span>
                            <input
                                type="text"
                                className="saas-input"
                                placeholder="e.g. 2023"
                                value={announcement.targetYear}
                                onChange={(event) => setAnnouncement((prev) => ({ ...prev, targetYear: event.target.value }))}
                            />
                        </label>
                        <label className="field">
                            <span>Day</span>
                            <input
                                type="date"
                                className="saas-input"
                                value={announcement.day}
                                onChange={(event) => setAnnouncement((prev) => ({ ...prev, day: event.target.value }))}
                            />
                        </label>
                        <label className="field">
                            <span>Time</span>
                            <input
                                type="time"
                                className="saas-input"
                                value={announcement.time}
                                onChange={(event) => setAnnouncement((prev) => ({ ...prev, time: event.target.value }))}
                            />
                        </label>
                        <label className="field">
                            <span>Location</span>
                            <input
                                type="text"
                                className="saas-input"
                                placeholder="Event venue or place"
                                value={announcement.location}
                                onChange={(event) => setAnnouncement((prev) => ({ ...prev, location: event.target.value }))}
                            />
                        </label>
                        <button type="submit" className="primary-btn">Post Announcement</button>
                    </form>
                </div>

                <aside className="audit-panel">
                    <h3>Announcement History</h3>
                    {announcements.length === 0 && <p className="empty">No announcements yet.</p>}
                    <div className="announcement-list announcement-history-scroll">
                        {announcements.map((item) => (
                            <div key={item.id} className="announcement-item announcement-history-card">
                                <div className="announcement-history-copy">
                                    <strong className="announcement-history-title">{item.title}</strong>
                                    <div className="announcement-history-meta">
                                        <div className="announcement-history-meta-item">
                                            <span>Date</span>
                                            <strong>{formatAnnouncementDate(item.day)}</strong>
                                        </div>
                                        <div className="announcement-history-meta-item">
                                            <span>Time</span>
                                            <strong>{formatAnnouncementTime(item.time)}</strong>
                                        </div>
                                        <div className="announcement-history-meta-item announcement-history-meta-item-wide">
                                            <span>Location</span>
                                            <strong>{item.location || "To be announced"}</strong>
                                        </div>
                                    </div>
                                    <div className="announcement-history-description">
                                        <span>Description</span>
                                        <p>{item.content}</p>
                                    </div>
                                </div>
                                <button type="button" className="danger-btn" onClick={() => removeAnnouncement(item.id)}>
                                    Delete
                                </button>
                            </div>
                        ))}
                    </div>
                </aside>
            </section>
        </AdminShell>
    );
}
