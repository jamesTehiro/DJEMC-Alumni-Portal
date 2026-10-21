import { academicInfo, academicLabel, programLabel, programKey } from "../../utils/academicPrograms";
import React, { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Modal } from "react-bootstrap";
import { api } from "../../services/api";
import useRenderDebug from "../../hooks/useRenderDebug";
import useStrictSafeEffect from "../../hooks/useStrictSafeEffect";
import AdminShell from "../../components/AdminShell";
import SectionHeader from "../../components/ui/SectionHeader";
import { ADMIN_SCOPE_META, clearSessionAndGoHome, getStoredUser, isAllowedAdminScope } from "./adminUtils";
import { resolveFileUrl } from "../../services/api";
import "../AdminEmployerPage.css";
import "../FeedPage.css";
import "../AdminAlumniPage.css";
import "./AdminAlumniRecordsPage.css";

const ACCOUNT_STATUS_LABELS = new Map([
    ["verified", "Verified"],
    ["pending", "Pending"],
    ["rejected", "Rejected"],
    ["suspended", "Suspended"],
    ["deactivated", "Deactivated"]
]);

export default function AdminUsersPage({ role }) {
    useRenderDebug(`AdminUsersPage:${role}`);
    const navigate = useNavigate();
    const [records, setRecords] = useState([]);
    const [recordsLoading, setRecordsLoading] = useState(true);
    const [selectedCourse, setSelectedCourse] = useState("");
    const [selectedYear, setSelectedYear] = useState("");
    const [message, setMessage] = useState("");
    const [error, setError] = useState("");
    const [selectedProfile, setSelectedProfile] = useState(null);
    const [profileLoading, setProfileLoading] = useState(false);
    const [trackingData, setTrackingData] = useState(null);
    const [trackingSummary, setTrackingSummary] = useState({ totalGraduates: 0, employed: 0, unemployed: 0, selfEmployed: 0 });
    const [trackingActivityError, setTrackingActivityError] = useState("");
    const [recordsQuery, setRecordsQuery] = useState("");
    const [recordsPage, setRecordsPage] = useState(1);
    const [recordsPageSize, setRecordsPageSize] = useState(10);
    const [profileTab, setProfileTab] = useState("overview");
    const [requestConfirmOpen, setRequestConfirmOpen] = useState(false);
    const [requestSending, setRequestSending] = useState(false);

    const user = useMemo(() => getStoredUser(), []);
    const isAllowed = isAllowedAdminScope(user, role);
    const scopeMeta = ADMIN_SCOPE_META[role];

    useStrictSafeEffect(
        `AdminUsersPage:init:${role}:${isAllowed}`,
        () => {
            if (!isAllowed) return undefined;

            const loadRecords = async () => {
                setRecordsLoading(true);
                try {
                    const data = await api.get(scopeMeta.usersEndpoint, true);
                    setRecords(Array.isArray(data) ? data : []);
                    if (role === "alumni") {
                        const summary = await api.get("/admin/alumni/tracking-summary", true);
                        setTrackingSummary(summary || { totalGraduates: 0, employed: 0, unemployed: 0, selfEmployed: 0 });
                    }
                } catch (err) {
                    setError(err.message);
                } finally {
                    setRecordsLoading(false);
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
        if (profile.role === "admin" || profile.admin_scope) return resolveFileUrl(profile.admin_avatar_url || "");
        return resolveFileUrl(profile.AlumniProfile?.avatar_url || profile.EmployerProfile?.logo_url || "");
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
        setTrackingData(null);
        setTrackingActivityError("");
        setProfileTab("overview");

        try {
            const result = await api.get(`/admin/alumni/users/${item.id}/tracking`, true);
            const latestProfile = result?.alumni || {};
            setTrackingData(result);
            setSelectedProfile({
                ...fallbackProfile,
                ...latestProfile,
                id: item.id,
                AlumniProfile: latestProfile.AlumniProfile || null,
                AlumniRecord: latestProfile.AlumniRecord || item.AlumniRecord,
                imageUrl: getProfileImage(latestProfile) || fallbackProfile.imageUrl
            });
        } catch (err) {
            setTrackingActivityError(err.message || "Failed to load alumni tracking details.");
        } finally {
            setProfileLoading(false);
        }
    };

    const submitProfileUpdateRequest = async () => {
        if (!selectedProfile?.id || requestSending) return;
        setRequestSending(true);
        setTrackingActivityError("");
        setError("");
        try {
            const result = await api.post(`/admin/alumni/users/${selectedProfile.id}/profile-update-requests`, {}, true);
            setMessage(result?.msg || "Profile update request sent.");
            setRequestConfirmOpen(false);
            const currentTime = new Date().toISOString();
            setRecords((previous) => previous.map((item) => Number(item.id) === Number(selectedProfile.id)
                ? { ...item, latestProfileUpdateRequest: { ...(result?.request || {}), createdAt: result?.request?.createdAt || currentTime } }
                : item));
            const refreshed = await api.get(`/admin/alumni/users/${selectedProfile.id}/tracking`, true);
            setTrackingData(refreshed);
        } catch (err) {
            setTrackingActivityError(err.message || "Unable to send the profile update request.");
        } finally {
            setRequestSending(false);
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

    if (role === "alumni") {
        const getRecordName = (item) => item.AlumniRecord?.full_name || item.name || "Unknown Alumni";
        const getRecordCourse = (item) => academicInfo(item).course;
        const getRecordMajor = (item) => academicInfo(item).major;
        const getRecordYear = (item) => item.AlumniRecord?.batch_year || item.AlumniProfile?.graduation_year || "";
        const courses = [...new Set(records.map(item => programKey(getRecordCourse(item))).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
        const years = [...new Set(records.map(getRecordYear).filter(Boolean))].sort((a, b) => Number(b) - Number(a));
        const filtered = records.filter((item) => {
            const profile = item.AlumniProfile || {};
            const query = recordsQuery.trim().toLowerCase();
            const matchesQuery = !query || [getRecordName(item), getRecordCourse(item), programLabel(getRecordCourse(item)), getRecordMajor(item), getRecordYear(item), profile.employment_status, profile.job_title, profile.current_company]
                .some((value) => String(value || "").toLowerCase().includes(query));
            return matchesQuery && (!selectedCourse || programKey(getRecordCourse(item)) === selectedCourse)
                && (!selectedYear || String(getRecordYear(item)) === String(selectedYear));
        }).sort((a, b) => getRecordName(a).localeCompare(getRecordName(b), undefined, { sensitivity: "base" }) || Number(a.id) - Number(b.id));
        const pageCount = Math.max(1, Math.ceil(filtered.length / recordsPageSize));
        const page = Math.min(recordsPage, pageCount);
        const visibleRecords = filtered.slice((page - 1) * recordsPageSize, page * recordsPageSize);
        const profileIsPrivate = String(selectedProfile?.AlumniProfile?.profile_visibility || "public").toLowerCase() !== "public";
        const latestRequest = [...(trackingData?.requests || [])].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
        const requestRecent = latestRequest?.createdAt && Date.now() - new Date(latestRequest.createdAt).getTime() < 7 * 24 * 60 * 60 * 1000;
        const requestActive = latestRequest && ["pending", "sent", "responded"].includes(latestRequest.status);
        const requestDisabled = Boolean(requestActive || requestRecent);
        const timeline = [
            ...(trackingData?.requests || []).map((request) => ({
                id: `request-${request.id}`,
                date: request.completed_at || request.responded_at || request.sent_at || request.createdAt,
                title: `Profile update request: ${String(request.status || "pending").replaceAll("_", " ")}`,
                detail: `${request.requester?.name ? `Requested by ${request.requester.name}. ` : ""}${request.emailQueueJob ? `Email status: ${request.emailQueueJob.status}.` : "In-app notification saved; no email delivery address available."}`
            })),
            ...(trackingData?.events || []).map((event) => ({
                id: `event-${event.id}`,
                date: event.created_at,
                title: event.action === "alumni.profile.updated" ? "Career profile updated" : event.action === "alumni.profile_update.responded" ? "Update request opened" : event.action === "alumni.account_status.changed" ? "Account verification status changed" : "Profile update request sent",
                detail: `${event.User?.name ? `By ${event.User.name}. ` : ""}${event.action === "alumni.account_status.changed" ? `Status: ${event.metadata?.from || "unknown"} → ${event.metadata?.to || "unknown"}.` : Array.isArray(event.metadata?.fields) ? `Updated sections: ${event.metadata.fields.join(", ")}.` : ""}`
            }))
        ].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
        const refreshTracking = async () => {
            if (!selectedProfile?.id) return;
            setProfileLoading(true);
            setTrackingActivityError("");
            try {
                setTrackingData(await api.get(`/admin/alumni/users/${selectedProfile.id}/tracking`, true));
            } catch (err) {
                setTrackingActivityError(err.message || "Unable to refresh tracking activity.");
            } finally {
                setProfileLoading(false);
            }
        };
        const closeDrawer = () => {
            setSelectedProfile(null);
            setTrackingData(null);
            setTrackingActivityError("");
        };

        return (
            <AdminShell
                scope={role}
                title="Alumni Records"
                subtitle="Track graduate employment and review profile updates using official master records."
                onLogout={() => clearSessionAndGoHome(navigate)}
            >
                {message && <p className="notice success" role="status">{message}</p>}
                {error && <p className="notice error" role="alert">{error}</p>}

                <section className="alumni-tracking-summary" aria-label="Alumni employment summary">
                    <article><span>Total Graduates</span><strong>{trackingSummary.totalGraduates}</strong><small>Official master-list records</small></article>
                    <article><span>Employed</span><strong>{trackingSummary.employed}</strong><small>Reported by linked alumni</small></article>
                    <article><span>Unemployed</span><strong>{trackingSummary.unemployed}</strong><small>Reported by linked alumni</small></article>
                    <article><span>Self-Employed</span><strong>{trackingSummary.selfEmployed}</strong><small>Reported by linked alumni</small></article>
                </section>

                <section className="queue-panel alumni-tracking-panel">
                    <div className="alumni-tracking-heading">
                        <div><h2>Graduate Tracking</h2><p>Summary counts use all official master-list records; table filters apply to the list below.</p></div>
                        <strong>{filtered.length} matching alumni</strong>
                    </div>
                    <div className="alumni-tracking-filters">
                        <input type="search" value={recordsQuery} placeholder="Search name, program, major, year, position, or company" onChange={(event) => { setRecordsQuery(event.target.value); setRecordsPage(1); }} aria-label="Search alumni records" />
                        <select value={selectedCourse} onChange={(event) => { setSelectedCourse(event.target.value); setRecordsPage(1); }} aria-label="Filter by course">
                            <option value="">All program</option>{courses.map((course) => <option key={course} value={course}>{programLabel(course)}</option>)}
                        </select>
                        <select value={selectedYear} onChange={(event) => { setSelectedYear(event.target.value); setRecordsPage(1); }} aria-label="Filter by academic year">
                            <option value="">Academic Year</option>{years.map((year) => <option key={year} value={year}>{year}</option>)}
                        </select>
                    </div>

                    <div className="alumni-tracking-table-wrap">
                        <table className="alumni-tracking-table">
                            <thead><tr><th>Alumnus</th><th>Academic Year</th><th>Program</th><th>Major / Specialization</th><th>Account Status</th><th>Actions</th></tr></thead>
                            <tbody>
                                {recordsLoading ? <tr><td colSpan="6" className="alumni-tracking-empty">Loading alumni records…</td></tr> : visibleRecords.length === 0 ? <tr><td colSpan="6" className="alumni-tracking-empty">No alumni match these filters.</td></tr> : visibleRecords.map((item) => {
                                    const rawAccountStatus = String(item.account_status || "").trim();
                                    const accountStatus = rawAccountStatus.toLowerCase();
                                    const accountStatusLabel = ACCOUNT_STATUS_LABELS.get(accountStatus) || rawAccountStatus || "Not available";
                                    const accountStatusTone = accountStatus === "verified" ? "" : accountStatus === "pending" ? "pending" : "neutral";
                                    return (
                                        <tr key={item.id} role="button" tabIndex={0} className={Number(selectedProfile?.id) === Number(item.id) ? "selected" : ""} onClick={() => openProfilePreview(item)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openProfilePreview(item); } }}>
                                            <td><strong>{getRecordName(item)}</strong></td>
                                            <td>{getRecordYear(item) || "Year not recorded"}</td>
                                            <td>{programLabel(getRecordCourse(item))}</td><td>{getRecordMajor(item) || "Not recorded"}</td>
                                            <td><span className={`alumni-tracking-status alumni-account-status ${accountStatusTone}`}>{accountStatusLabel}</span></td>
                                            <td><button type="button" className="alumni-profile-view-button" onClick={(event) => { event.stopPropagation(); openProfilePreview(item); }}>View Profile</button></td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    <div className="alumni-tracking-pagination">
                        <label>Rows per page <select value={recordsPageSize} onChange={(event) => { setRecordsPageSize(Number(event.target.value)); setRecordsPage(1); }}><option value={10}>10</option><option value={25}>25</option><option value={50}>50</option></select></label>
                        <span>Page {page} of {pageCount}</span>
                        <div><button type="button" onClick={() => setRecordsPage((value) => Math.max(1, value - 1))} disabled={page <= 1}>Previous</button><button type="button" onClick={() => setRecordsPage((value) => Math.min(pageCount, value + 1))} disabled={page >= pageCount}>Next</button></div>
                    </div>
                </section>

                {selectedProfile && <div className="alumni-profile-drawer-backdrop" onClick={closeDrawer}>
                    <aside className="alumni-profile-drawer" role="dialog" aria-modal="true" aria-label={`Profile for ${selectedProfile.name}`} onClick={(event) => event.stopPropagation()}>
                        <header className="alumni-profile-drawer-header">
                            <div className="alumni-profile-drawer-person">
                                <div className={`alumni-record-profile-avatar ${profileImage ? "has-photo" : ""}`}>{profileImage ? <img src={profileImage} alt="" /> : getInitials(selectedProfile.name)}</div>
                                <div><h2>{selectedProfile.AlumniRecord?.full_name || selectedProfile.name}</h2><p>{academicLabel(getRecordCourse(selectedProfile), getRecordMajor(selectedProfile))} · Class of {selectedProfile.AlumniRecord?.batch_year || profileGraduationYear || "Not recorded"}</p><span className={`employment-status-badge ${getEmploymentStatus(selectedProfile)?.tone || ""}`}>{getEmploymentStatus(selectedProfile)?.label || "Employment not specified"}</span></div>
                            </div>
                            <button type="button" aria-label="Close profile" onClick={closeDrawer}>×</button>
                        </header>
                        <div className="alumni-profile-drawer-actions">
                            <button type="button" className="primary-btn" onClick={() => setRequestConfirmOpen(true)} disabled={requestDisabled || requestSending}>
                                {requestActive ? "Update Request Active" : requestRecent ? "Request Sent Recently" : "Request Profile Update"}
                            </button>
                            {requestRecent && <small>Another request can be sent after the seven-day cooldown.</small>}
                        </div>
                        <nav className="alumni-profile-tabs" aria-label="Alumni profile sections">
                            {["overview", "employment", "tracking"].map((tab) => <button key={tab} type="button" className={profileTab === tab ? "active" : ""} onClick={() => setProfileTab(tab)}>{tab === "employment" ? "Employment History" : tab === "tracking" ? "Tracking Activity" : "Overview"}</button>)}
                        </nav>
                        <div className="alumni-profile-drawer-content">
                            {profileLoading && <p className="alumni-tracking-muted">Loading permitted profile and tracking details…</p>}
                            {trackingActivityError && <div className="alumni-tracking-error" role="alert">{trackingActivityError}<button type="button" onClick={refreshTracking}>Retry</button></div>}
                            {!profileLoading && profileTab === "overview" && <div className="alumni-profile-overview">
                                <h3>Overview</h3><dl><dt>Program</dt><dd>{programLabel(getRecordCourse(selectedProfile))}</dd><dt>Major / Specialization</dt><dd>{getRecordMajor(selectedProfile) || "Not recorded"}</dd><dt>Graduation year</dt><dd>{selectedProfile.AlumniRecord?.batch_year || profileGraduationYear || "Not recorded"}</dd><dt>Account status</dt><dd>{selectedProfile.account_status || "Pending"}</dd><dt>Employment status</dt><dd>{getEmploymentStatus(selectedProfile)?.label || "Not specified"}</dd>
                                    {!profileIsPrivate && <><dt>Current position</dt><dd>{selectedProfile.AlumniProfile?.job_title || "Not listed"}</dd><dt>Company</dt><dd>{selectedProfile.AlumniProfile?.current_company || "Not listed"}</dd></>}
                                    <dt>Profile visibility</dt><dd>{profileIsPrivate ? "Private employment details are hidden" : "Public"}</dd><dt>Last profile update</dt><dd>{selectedProfile.AlumniProfile?.updatedAt ? new Date(selectedProfile.AlumniProfile.updatedAt).toLocaleString() : "Not recorded"}</dd>
                                </dl>
                            </div>}
                            {!profileLoading && profileTab === "employment" && <div><h3>Employment History</h3>{profileIsPrivate ? <p className="alumni-tracking-muted">Employment details are hidden by this alumnus's profile visibility setting.</p> : employmentHistory.length ? employmentHistory.map((job) => <article className="alumni-profile-history-item" key={job.id}><strong>{job.position || "Position not listed"}</strong><span>{job.company_name || "Company not listed"}</span><small>{[job.start_year, job.end_year || (job.is_current ? "Present" : "")].filter(Boolean).join(" – ") || "Dates not recorded"}{job.employment_type ? ` · ${job.employment_type}` : ""}</small></article>) : <p className="alumni-tracking-muted">No employment history available.</p>}</div>}
                            {!profileLoading && profileTab === "tracking" && <div><div className="alumni-profile-tab-heading"><h3>Tracking Activity</h3><button type="button" onClick={refreshTracking}>Refresh</button></div>{timeline.length ? <ol className="alumni-tracking-timeline">{timeline.map((event) => <li key={event.id}><strong>{event.title}</strong><time>{event.date ? new Date(event.date).toLocaleString() : "Date unavailable"}</time>{event.detail && <p>{event.detail}</p>}</li>)}</ol> : <p className="alumni-tracking-muted">No tracking activity recorded yet.</p>}</div>}
                        </div>
                    </aside>
                </div>}

                <Modal show={requestConfirmOpen} onHide={() => !requestSending && setRequestConfirmOpen(false)} centered>
                    <Modal.Header closeButton><Modal.Title>Request Profile Update</Modal.Title></Modal.Header>
                    <Modal.Body>
                        <p>Send a profile update request to <strong>{selectedProfile?.AlumniRecord?.full_name || selectedProfile?.name}</strong>?</p>
                        <p className="mb-0">They will receive an in-app notification and, when an email address is available, an email will be queued. Their employment status will not change unless they update it.</p>
                        {trackingActivityError && <div className="alumni-tracking-error mt-3" role="alert">{trackingActivityError}</div>}
                    </Modal.Body>
                    <Modal.Footer><button type="button" className="secondary-btn" onClick={() => setRequestConfirmOpen(false)} disabled={requestSending}>Cancel</button><button type="button" className="primary-btn" onClick={submitProfileUpdateRequest} disabled={requestSending}>{requestSending ? "Sending…" : "Confirm Request"}</button></Modal.Footer>
                </Modal>
            </AdminShell>
        );
    }

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

