import React, { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Modal } from "react-bootstrap";
import { api } from "../../services/api";
import useRenderDebug from "../../hooks/useRenderDebug";
import useStrictSafeEffect from "../../hooks/useStrictSafeEffect";
import AdminShell from "../../components/AdminShell";
import SectionHeader from "../../components/ui/SectionHeader";
import { ADMIN_SCOPE_META, clearSessionAndGoHome, getStoredUser, isAllowedAdminScope } from "./adminUtils";
import "../AdminEmployerPage.css";
import "../FeedPage.css";
import "../AdminAlumniPage.css";

export default function AdminUsersPage({ role }) {
    useRenderDebug(`AdminUsersPage:${role}`);
    const navigate = useNavigate();
    const [records, setRecords] = useState([]);
    const [selectedCourse, setSelectedCourse] = useState("");
    const [selectedYear, setSelectedYear] = useState("");
    const [message, setMessage] = useState("");
    const [error, setError] = useState("");
    const [selectedProfile, setSelectedProfile] = useState(null);
    const [profileLoading, setProfileLoading] = useState(false);

    const user = useMemo(() => getStoredUser(), []);
    const isAllowed = isAllowedAdminScope(user, role);
    const scopeMeta = ADMIN_SCOPE_META[role];

    useStrictSafeEffect(
        `AdminUsersPage:init:${role}:${isAllowed}`,
        () => {
            if (!isAllowed) return undefined;

            const loadRecords = async () => {
                try {
                    const data = await api.get(scopeMeta.usersEndpoint, true);
                    setRecords(Array.isArray(data) ? data : []);
                } catch (err) {
                    setError(err.message);
                }
            };

            loadRecords();
            return undefined;
        },
        [isAllowed, scopeMeta.usersEndpoint, role],
        { label: `AdminUsersPage init (${role})` }
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

    const verifiedRecords =
        role === "alumni"
            ? records.filter((item) => item.account_status === "verified")
            : records;
    const availableCourses = role === "alumni"
        ? [...new Set(verifiedRecords.map((item) => String(item.AlumniProfile?.course || "").trim()).filter(Boolean))]
            .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
        : [];
    const courseRecords = selectedCourse
        ? verifiedRecords.filter((item) => String(item.AlumniProfile?.course || "").trim() === selectedCourse)
        : [];
    const availableYears = [...new Set(courseRecords
        .map((item) => item.AlumniProfile?.graduation_year)
        .filter((year) => year !== null && year !== undefined && String(year).trim() !== ""))]
        .sort((a, b) => Number(b) - Number(a));
    const filteredRecords =
        role === "alumni"
            ? verifiedRecords.filter((item) => {
                const profile = item.AlumniProfile || {};
                const courseMatches = !selectedCourse || String(profile.course || "").trim() === selectedCourse;
                const yearMatches = String(profile.graduation_year ?? "") === String(selectedYear);
                return selectedYear && courseMatches && yearMatches;
            }).sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" }) || Number(a.id) - Number(b.id))
            : verifiedRecords;
    const directoryLevel = !selectedCourse ? "courses" : !selectedYear ? "years" : "alumni";

    const getInitials = (value) =>
        String(value || "U")
            .trim()
            .split(/\s+/)
            .slice(0, 2)
            .map((part) => part[0]?.toUpperCase() || "")
            .join("") || "U";

    const formatRoleLabel = (profile) => {
        if (!profile) return "User";
        if (profile.role === "admin" || profile.admin_scope) return "Admin";
        if (profile.role === "employer") return "Employer";
        return "Alumni";
    };

    const getProfileImage = (profile) => {
        if (!profile) return "";
        if (profile.role === "admin" || profile.admin_scope) return profile.admin_avatar_url || "";
        return profile.AlumniProfile?.avatar_url || profile.EmployerProfile?.logo_url || "";
    };

    const openProfilePreview = async (item) => {
        if (!item?.id) return;

        const fallbackProfile = {
            ...item,
            name: item.name || "Unknown Alumni",
            imageUrl: getProfileImage(item)
        };

        setSelectedProfile(fallbackProfile);
        setProfileLoading(true);
        setError("");

        try {
            const latestProfile = await api.get(`/profile/${item.id}`, true);
            setSelectedProfile({
                ...fallbackProfile,
                ...(latestProfile || {}),
                imageUrl: getProfileImage(latestProfile || fallbackProfile)
            });
        } catch (err) {
            setError(err.message || "Failed to load profile preview.");
        } finally {
            setProfileLoading(false);
        }
    };

    const employmentHistory = selectedProfile?.AlumniProfile?.EmploymentHistories || [];
    const profileCourse = selectedProfile?.AlumniProfile?.course || "Course not set";
    const profileGraduationYear = selectedProfile?.AlumniProfile?.graduation_year;
    const profileImage = selectedProfile?.imageUrl || getProfileImage(selectedProfile);
    const getEmploymentStatus = (item) => {
        const value = String(item?.AlumniProfile?.employment_status || "").trim().toLowerCase().replace(/[_\s]+/g, "-");
        if (value === "employed") return { label: "Employed", tone: "employed" };
        if (value === "unemployed") return { label: "Unemployed", tone: "unemployed" };
        if (value === "self-employed") return { label: "Self-Employed", tone: "self-employed" };
        return null;
    };

    return (
        <AdminShell
            scope={role}
            title={role === "alumni" ? "Alumni Records" : "User Management"}
            subtitle={
                role === "alumni"
                    ? "Search verified alumni records by name and review directory details."
                    : "Maintain employer profiles and account states."
            }
            onLogout={() => clearSessionAndGoHome(navigate)}
        >
            {message && <p className="notice success">{message}</p>}
            {error && <p className="notice error">{error}</p>}

            <section className="content-grid content-grid-single">
                <div className="queue-panel">
                    <SectionHeader
                        title={role === "alumni" ? "Verified Alumni Directory" : "Employer Directory"}
                        meta={`${role === "alumni" ? (directoryLevel === "courses" ? availableCourses.length : directoryLevel === "years" ? availableYears.length : filteredRecords.length) : records.length} ${role === "alumni" ? (directoryLevel === "courses" ? "Programs" : directoryLevel === "years" ? "Graduation Years" : "Alumni") : "Total"}`}
                    />
                    {role === "alumni" && directoryLevel === "courses" && (
                        <div className="directory-selection-grid" aria-label="Available programs">
                            {availableCourses.length ? availableCourses.map((course) => {
                                const count = verifiedRecords.filter((item) => String(item.AlumniProfile?.course || "").trim() === course).length;
                                return <button type="button" className="directory-selection-card" key={course} onClick={() => { setSelectedCourse(course); setSelectedYear(""); }}><strong>{course}</strong><span>{count} verified alumni</span></button>;
                            }) : <p className="directory-empty-state">No verified alumni programs available.</p>}
                        </div>
                    )}
                    {role === "alumni" && directoryLevel === "years" && (
                        <div className="directory-drilldown">
                            <div className="directory-breadcrumb"><button type="button" onClick={() => { setSelectedCourse(""); setSelectedYear(""); }}>Program</button><span>&rsaquo;</span><strong>{selectedCourse}</strong></div>
                            <button type="button" className="directory-back-button" onClick={() => { setSelectedCourse(""); setSelectedYear(""); }}>&larr; Back to programs</button>
                            <div className="directory-selection-grid" aria-label={`Graduation years for ${selectedCourse}`}>
                                {availableYears.length ? availableYears.map((year) => {
                                    const count = courseRecords.filter((item) => String(item.AlumniProfile?.graduation_year) === String(year)).length;
                                    return <button type="button" className="directory-selection-card" key={String(year)} onClick={() => setSelectedYear(String(year))}><strong>{year}</strong><span>{count} verified alumni</span></button>;
                                }) : <p className="directory-empty-state">No graduation years available for {selectedCourse}.</p>}
                            </div>
                        </div>
                    )}
                    {role === "alumni" && directoryLevel === "alumni" && <div className="directory-drilldown">
                        <div className="directory-breadcrumb"><button type="button" onClick={() => { setSelectedCourse(""); setSelectedYear(""); }}>Program</button><span>&rsaquo;</span><button type="button" onClick={() => setSelectedYear("")}>{selectedCourse}</button><span>&rsaquo;</span><strong>{selectedYear}</strong></div>
                        <button type="button" className="directory-back-button" onClick={() => setSelectedYear("")}>&larr; Back to graduation years</button>
                    </div>}
                    {(role !== "alumni" || directoryLevel === "alumni") && <div className="queue-table alumni-directory-table">
                        <div className="queue-row header alumni-directory-row">
                            {role === "alumni" ? (
                                <>
                                    <span>Name</span>
                                    <span>Course</span>
                                    <span>YEAR GRADUATED</span>
                                    <span>Employment Status</span>
                                    <span>Job Title / Position</span>
                                    <span>Location</span>
                                    <span></span>
                                </>
                            ) : (
                                <>
                                    <span>Organization</span>
                                    <span>Status</span>
                                    <span>Industry</span>
                                    <span>Contact</span>
                                    <span></span>
                                </>
                            )}
                        </div>
                        {filteredRecords.map((item) => (
                            <div className="queue-row alumni-directory-row" key={item.id}>
                                {role === "alumni" ? (
                                    <>
                                        <div>
                                            <strong>{item.name}</strong>
                                            <p>{item.email}</p>
                                        </div>
                                        <span>{item.AlumniProfile?.course || "N/A"}</span>
                                        <span>{item.AlumniProfile?.graduation_year || "N/A"}</span>
                                        <span>
                                            {(() => {
                                                const employment = getEmploymentStatus(item);
                                                return employment
                                                    ? <span className={`employment-status-badge ${employment.tone}`}>{employment.label}</span>
                                                    : <span className="directory-empty-value">{"\u2014"}</span>;
                                            })()}
                                        </span>
                                        <span className="directory-job-title" title={item.AlumniProfile?.job_title || ""}>{item.AlumniProfile?.job_title || <span className="directory-empty-value">{"\u2014"}</span>}</span>
                                        <span className="directory-location" title={item.AlumniProfile?.address || ""}>{item.AlumniProfile?.address || <span className="directory-empty-value">{"\u2014"}</span>}</span>
                                    </>
                                ) : (
                                    <>
                                        <div>
                                            <strong>{item.EmployerProfile?.organization_name || item.name}</strong>
                                            <p>{item.email}</p>
                                        </div>
                                        <span className="pill">{item.account_status || "pending"}</span>
                                        <span>{item.EmployerProfile?.industry || "N/A"}</span>
                                        <span>{item.EmployerProfile?.contact_email || item.email}</span>
                                    </>
                                )}
                                <div className="actions">
                                    <details className="action-menu">
                                        <summary>...</summary>
                                        {role === "alumni" && (
                                            <button type="button" onClick={() => openProfilePreview(item)}>
                                                View Profile
                                            </button>
                                        )}
                                    </details>
                                </div>
                            </div>
                        ))}
                        {role === "alumni" && directoryLevel === "alumni" && filteredRecords.length === 0 && (
                            <div className="queue-row alumni-directory-row">
                                <span>No verified alumni found.</span>
                                <span></span>
                                <span></span>
                                <span></span>
                                <span></span>
                                <span></span>
                                <span></span>
                            </div>
                        )}
                    </div>}
                </div>

            </section>

            <Modal
                show={!!selectedProfile}
                onHide={() => {
                    setSelectedProfile(null);
                    setProfileLoading(false);
                }}
                centered
                dialogClassName="feed-profile-modal alumni-record-profile-modal"
                contentClassName="feed-profile-modal-content"
            >
                <Modal.Header closeButton className="feed-profile-modal-header">
                    <Modal.Title>Alumni Profile</Modal.Title>
                </Modal.Header>
                <Modal.Body className="feed-profile-modal-body alumni-record-profile-body">
                    <div className="alumni-record-profile-card">
                        <div className="alumni-record-profile-top">
                            <div className={`alumni-record-profile-avatar ${profileImage ? "has-photo" : ""}`}>
                                {profileImage ? (
                                    <img src={profileImage} alt={selectedProfile?.name || "Alumni profile"} />
                                ) : (
                                    getInitials(selectedProfile?.name)
                                )}
                            </div>
                            <div className="alumni-record-profile-copy">
                                <h3>{selectedProfile?.name || "Unknown Alumni"}</h3>
                                <p className="alumni-record-profile-course">{profileCourse}</p>
                                <p>{profileGraduationYear ? `Class of ${profileGraduationYear}` : "Class year not set"}</p>
                                <p>{selectedProfile?.email || "No email available"}</p>
                                <span className="alumni-record-profile-role">{formatRoleLabel(selectedProfile)}</span>
                            </div>
                        </div>

                        <div className="alumni-record-profile-section">
                            <h4>Employment History</h4>
                            {profileLoading ? (
                                <p className="alumni-record-profile-empty">Loading profile details...</p>
                            ) : employmentHistory.length ? (
                                employmentHistory.map((job) => (
                                    <div
                                        key={job.id || `${job.position || "job"}-${job.company_name || "company"}-${job.start_year || ""}`}
                                        className="alumni-record-employment-card"
                                    >
                                        <strong>
                                            {job.position || "Role not set"}
                                            {job.company_name ? ` at ${job.company_name}` : ""}
                                        </strong>
                                        <span>
                                            {[job.start_year, job.end_year || (job.is_current ? "Present" : "")]
                                                .filter(Boolean)
                                                .join(" - ") || "Employment dates not set"}
                                            {job.employment_type ? ` | ${job.employment_type}` : ""}
                                        </span>
                                    </div>
                                ))
                            ) : (
                                <p className="alumni-record-profile-empty">No employment history available yet.</p>
                            )}
                        </div>
                    </div>
                </Modal.Body>
            </Modal>
        </AdminShell>
    );
}

