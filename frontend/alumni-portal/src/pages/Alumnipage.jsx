import { applicationStatusLabel } from "../utils/applicationStatus";
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Row, Col, Card } from "react-bootstrap";
import { MdMail, MdCampaign } from "react-icons/md";
import { FaBriefcase } from "react-icons/fa";
import { BsBuilding } from "react-icons/bs";
import { FiBell } from "react-icons/fi";
import { api } from "../services/api";
import useRenderDebug from "../hooks/useRenderDebug";
import useStrictSafeEffect from "../hooks/useStrictSafeEffect";
import { getEmploymentTypeLabel } from "../utils/employmentTypes";
import MembershipOnboarding from "../components/membership/MembershipOnboarding";

import "./Alumnipage.css";

export default function AlumniPage() {
    useRenderDebug("AlumniPage");
    const navigate = useNavigate();
    const [jobs, setJobs] = useState([]);
    const [announcements, setAnnouncements] = useState([]);
    const [applications, setApplications] = useState([]);
    const [notificationCount, setNotificationCount] = useState(0);
    const [error, setError] = useState("");
    const [dashboardPanel, setDashboardPanel] = useState("jobs");

    useStrictSafeEffect(
        "AlumniPage:init",
        () => {
            const loadDashboard = async () => {
                try {
                    const [jobsRes, annRes] = await Promise.all([
                        api.get("/jobs"),
                        api.get("/announcements")
                    ]);

                    setJobs(Array.isArray(jobsRes) ? jobsRes : []);
                    setAnnouncements(Array.isArray(annRes) ? annRes : []);

                    try {
                        const appsRes = await api.get("/applications", true);
                        setApplications(Array.isArray(appsRes) ? appsRes : []);
                    } catch {
                        setApplications([]);
                    }

                    try {
                        const notifRes = await api.get("/notifications", true);
                        const unread = (Array.isArray(notifRes) ? notifRes : []).filter((n) => !n.isRead).length;
                        setNotificationCount(unread);
                    } catch {
                        setNotificationCount(0);
                    }
                } catch (err) {
                    setError(err.message);
                }
            };

            loadDashboard();
            return undefined;
        },
        [],
        { label: "AlumniPage init" }
    );

    const user = useMemo(() => {
        try {
            return JSON.parse(localStorage.getItem("user") || "null");
        } catch {
            return null;
        }
    }, []);

    const formatDate = (value) => {
        if (!value) return "Date unavailable";
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return "Date unavailable";
        return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    };

    const shortText = (value, max = 110) => {
        const text = value || "";
        if (text.length <= max) return text || "No job description provided.";
        return `${text.slice(0, max).trim()}...`;
    };

    const handleLogout = () => {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        navigate("/");
    };

    const latestJobs = jobs.slice(0, 6);

    return (
        <div className="alumni-shell">
            <main className="alumni-main">
                <div className="alumni-layout">
                    <MembershipOnboarding />
                    <div className="welcome-banner">
                        <div className="welcome-text">
                            <h2>Welcome back, {user?.name || "Alumni"}!</h2>
                            <p>{user?.role || "alumni"} - DJEMC Portal</p>
                        </div>
                        <div
                            className="welcome-bell"
                            role="button"
                            tabIndex={0}
                            onClick={() => navigate("/notifications")}
                            onKeyPress={(e) => e.key === "Enter" && navigate("/notifications")}
                        >
                            <FiBell />
                            {notificationCount > 0 && <span className="welcome-badge">{notificationCount}</span>}
                        </div>
                    </div>

                    {error && <p>{error}</p>}

                    <div className="alu-dash-metrics mobile-scroll-cards">
                        <button
                            type="button"
                            className={`alu-dash-card ${dashboardPanel === "jobs" ? "active" : ""}`}
                            onClick={() => setDashboardPanel("jobs")}
                        >
                            <div className="alu-dash-card-icon jobs-icon">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></svg>
                            </div>
                            <div className="alu-dash-card-count">{jobs.length}</div>
                            <div className="alu-dash-card-label">Available Jobs</div>
                        </button>
                        <button
                            type="button"
                            className={`alu-dash-card ${dashboardPanel === "applications" ? "active" : ""}`}
                            onClick={() => setDashboardPanel("applications")}
                        >
                            <div className="alu-dash-card-icon apps-icon">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" /></svg>
                            </div>
                            <div className="alu-dash-card-count">{applications.length}</div>
                            <div className="alu-dash-card-label">Applications</div>
                        </button>
                        <button
                            type="button"
                            className={`alu-dash-card ${dashboardPanel === "announcements" ? "active" : ""}`}
                            onClick={() => setDashboardPanel("announcements")}
                        >
                            <div className="alu-dash-card-icon announce-icon">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2L11 13" /><path d="M22 2l-7 20-4-9-9-4 20-7z" /></svg>
                            </div>
                            <div className="alu-dash-card-count">{announcements.length}</div>
                            <div className="alu-dash-card-label">Announcements</div>
                        </button>
                        <button
                            type="button"
                            className={`alu-dash-card ${dashboardPanel === "notifications" ? "active" : ""}`}
                            onClick={() => setDashboardPanel("notifications")}
                        >
                            <div className="alu-dash-card-icon notif-icon">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
                            </div>
                            <div className="alu-dash-card-count">{notificationCount}</div>
                            <div className="alu-dash-card-label">Notifications</div>
                        </button>
                    </div>

                    <div className="alu-dash-panel">
                        {dashboardPanel === "jobs" && (
                            <div className="alu-dash-panel-inner fade-in">
                                <div className="alu-dash-panel-header">
                                    <h3>Latest Job Opportunities</h3>
                                    <span className="alu-view-all" onClick={() => navigate("/jobs")}>View All →</span>
                                </div>
                                {latestJobs.length === 0 ? (
                                    <div className="alu-dash-empty">
                                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></svg>
                                        <p>No jobs available at the moment.</p>
                                    </div>
                                ) : (
                                    <div className="alu-job-grid">
                                        {latestJobs.map((job) => (
                                            <div className="alu-job-card" key={job.id}>
                                                <div className="alu-job-top">
                                                    <div className="alu-job-avatar">
                                                        <BsBuilding size={18} />
                                                    </div>
                                                    <div className="alu-job-meta">
                                                        <h4>{job.title}</h4>
                                                        <p className="alu-job-company">{job.User?.name || "Employer"}</p>
                                                    </div>
                                                </div>
                                                <div className="alu-job-tags">
                                                    <span className="alu-job-tag">{getEmploymentTypeLabel(job.employment_type, "Full-Time")}</span>
                                                    <span className="alu-job-tag location">{job.location || "No location"}</span>
                                                    <span className="alu-job-date">{formatDate(job.createdAt)}</span>
                                                </div>
                                                <p className="alu-job-desc">{shortText(job.description)}</p>
                                                <div className="alu-job-footer">

                                                    <span className="alu-job-qual">{job.course_target || "Open to All"}</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                        {dashboardPanel === "applications" && (
                            <div className="alu-dash-panel-inner fade-in">
                                <div className="alu-dash-panel-header">
                                    <h3>My Applications</h3>
                                    <span>{applications.length} total</span>
                                </div>
                                {applications.length === 0 ? (
                                    <div className="alu-dash-empty">
                                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                                        <p>No applications yet. Browse jobs to get started.</p>
                                    </div>
                                ) : (
                                    applications.map((app) => (
                                        <div className="alu-list-item" key={app.id}>
                                            <div className="alu-list-item-left">
                                                <strong>{app.Job?.title || "Position"}</strong>
                                                <p>{app.Job?.User?.name || "Employer"} • {formatDate(app.createdAt)}</p>
                                            </div>
                                            <div className="alu-list-item-right">
                                                <span className={`alu-status-badge ${app.status === "verified" ? "approved" : app.status === "not_verified" ? "rejected" : "pending"}`}>
                                                    {applicationStatusLabel(app.status)}
                                                </span>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        )}
                        {dashboardPanel === "announcements" && (
                            <div className="alu-dash-panel-inner fade-in">
                                <div className="alu-dash-panel-header">
                                    <h3>Announcements</h3>
                                    <span>{announcements.length} total</span>
                                </div>
                                {announcements.length === 0 ? (
                                    <div className="alu-dash-empty">
                                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2L11 13" /><path d="M22 2l-7 20-4-9-9-4 20-7z" /></svg>
                                        <p>No announcements yet.</p>
                                    </div>
                                ) : (
                                    announcements.map((ann) => (
                                        <div className="alu-announce-item" key={ann.id}>
                                            <div className="alu-announce-icon">
                                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2L11 13" /><path d="M22 2l-7 20-4-9-9-4 20-7z" /></svg>
                                            </div>
                                            <div className="alu-announce-content">
                                                <strong>{ann.title || "Announcement"}</strong>
                                                <p>{ann.message || ann.content || ""}</p>
                                                <span className="alu-announce-date">{formatDate(ann.createdAt)}</span>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        )}
                        {dashboardPanel === "notifications" && (
                            <div className="alu-dash-panel-inner fade-in">
                                <div className="alu-dash-panel-header">
                                    <h3>Notifications</h3>
                                    <span>{notificationCount} unread</span>
                                </div>
                                <div className="alu-dash-empty">
                                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
                                    <p>{notificationCount > 0 ? `${notificationCount} unread notification(s)` : "No unread notifications."}</p>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </main>
        </div>
    );
}

