import React, { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../services/api";
import useRenderDebug from "../../hooks/useRenderDebug";
import useStrictSafeEffect from "../../hooks/useStrictSafeEffect";
import AdminShell from "../../components/AdminShell";
import SectionHeader from "../../components/ui/SectionHeader";
import { ADMIN_SCOPE_META, clearSessionAndGoHome, getStoredUser, isAllowedAdminScope } from "./adminUtils";
import "../AdminEmployerPage.css";
import "./AdminLogsPage.css";

export default function AdminLogsPage({ role }) {
    useRenderDebug(`AdminLogsPage:${role}`);
    const navigate = useNavigate();
    const [primaryRecords, setPrimaryRecords] = useState([]);
    const [secondaryRecords, setSecondaryRecords] = useState([]);
    const [auditRecords, setAuditRecords] = useState([]);
    const [error, setError] = useState("");

    const user = useMemo(() => getStoredUser(), []);
    const isAllowed = isAllowedAdminScope(user, role);
    const scopeMeta = ADMIN_SCOPE_META[role];

    useStrictSafeEffect(
        `AdminLogsPage:init:${role}:${isAllowed}`,
        () => {
            if (!isAllowed) return undefined;

            const loadData = async () => {
                try {
                    // For employer logs, prefer a dedicated logs endpoint if available.
                    if (role === "employer") {
                        try {
                            const logs = await api.get(`/admin/${role}/logs`, true);
                            if (Array.isArray(logs)) {
                                setAuditRecords(logs);
                                return;
                            }
                        } catch (e) {
                            // ignore and fall back
                            console.warn("Employer logs endpoint not available:", e?.message);
                        }
                    }

                    const [primaryData, secondaryData] = await Promise.all([
                        api.get(scopeMeta.usersEndpoint, true),
                        api.get(scopeMeta.logsSecondaryEndpoint, true)
                    ]);
                    setPrimaryRecords(Array.isArray(primaryData) ? primaryData : []);
                    setSecondaryRecords(Array.isArray(secondaryData) ? secondaryData : []);
                } catch (err) {
                    setError(err.message);
                }
            };

            loadData();
            return undefined;
        },
        [isAllowed, role, scopeMeta.logsSecondaryEndpoint, scopeMeta.usersEndpoint],
        { label: `AdminLogsPage init (${role})` }
    );

    const auditLog = useMemo(() => {
        const formatDate = (value) => (value ? new Date(value).toLocaleString() : "N/A");

        if (auditRecords && auditRecords.length > 0) {
            return auditRecords
                .map((r, index) => ({
                    id: r.id || `log-${index}`,
                    user_name: r.user_name || r.userName || r.actor || r.user || "System",
                    user_role: r.user_role || r.userRole || r.role || "",
                    action: r.action || r.event || r.type || "",
                    description: r.description || r.msg || r.message || "",
                    ip_address: r.ip_address || r.ip || r.ipAddress || "",
                    user_agent: r.user_agent || r.userAgent || r.ua || "",
                    time: formatDate(r.created_at || r.createdAt || r.time)
                }))
                .sort((a, b) => new Date(b.time) - new Date(a.time));
        }

        const primaryLogs = primaryRecords.map((item) => ({
            id: `${role}-primary-${item.id}`,
            user_name: item.name || item.email || "System",
            user_role: role === "alumni" ? "Alumni" : "Employer",
            action: role === "alumni" ? `Alumni account created` : `Employer account created`,
            description: item.name || item.email,
            ip_address: "",
            user_agent: "",
            time: formatDate(item.createdAt),
            rawTime: item.createdAt ? new Date(item.createdAt).getTime() : 0
        }));
        const secondaryLogs = secondaryRecords.map((item) => {
            const employerName = item.User?.name || item.User?.email || "System";
            return {
                id: `${role}-secondary-${item.id}`,
                user_name: employerName,
                user_role: "System",
                action: role === "alumni" ? `Announcement published` : `Job posted`,
                description: item.title || "",
                employer_name: employerName,
                posted_by: employerName,
                ip_address: "",
                user_agent: "",
                time: formatDate(item.createdAt),
                rawTime: item.createdAt ? new Date(item.createdAt).getTime() : 0
            };
        });

        return [...primaryLogs, ...secondaryLogs]
            .sort((a, b) => (b.rawTime || 0) - (a.rawTime || 0))
            .map(({ rawTime: _rawTime, ...rest }) => rest);
    }, [primaryRecords, role, secondaryRecords, auditRecords]);

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

    return (
        <AdminShell
            scope={role}
            title="System Logs"
            subtitle="Track administrative events and system audits."
            onLogout={() => clearSessionAndGoHome(navigate)}
        >
            {error && <p className="notice error">{error}</p>}

            <section className="content-grid system-logs-layout">
                <div className="queue-panel">
                    <SectionHeader title="Audit Timeline" meta="Latest activity" />
                    <div className="audit-timeline">
                        {auditRecords && auditRecords.length > 0 ? (
                            <div className="logs-table">
                                <div className="queue-row header">
                                    <span>User Name</span>
                                    <span>Role</span>
                                    <span>Action</span>
                                    <span>Description</span>
                                    <span>IP</span>
                                    <span>Device</span>
                                    <span>Timestamp</span>
                                </div>
                                {auditLog.map((entry) => (
                                    <div className="queue-row" key={entry.id}>
                                        <span>{entry.user_name}</span>
                                        <span>{entry.user_role}</span>
                                        <span>{entry.action}</span>
                                        <span>{entry.description}</span>
                                        <span>{entry.ip_address}</span>
                                        <span>{entry.user_agent}</span>
                                        <span>{entry.time}</span>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            auditLog.map((entry) => {
                                const isJobLog = entry.action === "Job posted";
                                const employerName = entry.employer_name || entry.posted_by || "System";
                                const title = entry.description || "";

                                return (
                                    <div key={entry.id} className="audit-item">
                                        <div className="audit-node" />
                                        <div>
                                            <p className="audit-action">
                                                <strong>{entry.user_name || entry.actor || "System"}</strong> {entry.action}
                                                {isJobLog && title && (
                                                    <>
                                                        <br />
                                                        <span className="audit-detail">
                                                            <strong>Job:</strong> {title}
                                                        </span>
                                                        {(employerName !== entry.user_name) && (
                                                            <span className="audit-detail">
                                                                <br />
                                                                <strong>Employer:</strong> {employerName}
                                                            </span>
                                                        )}
                                                    </>
                                                )}
                                            </p>
                                            <span>{entry.time}</span>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>

            </section>
        </AdminShell>
    );
}

