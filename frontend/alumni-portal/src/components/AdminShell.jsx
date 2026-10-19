import React, { useCallback, useContext, useLayoutEffect, useMemo, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import { FiMenu, FiX } from "react-icons/fi";
import usePortalDrawer from "../hooks/usePortalDrawer";
import {
    FaTachometerAlt,
    FaUsers,
    FaEnvelope,
    FaBullhorn,
    FaClipboardList,
    FaUser,
    FaUserCheck,
    FaBriefcase,
    FaSignOutAlt
} from "react-icons/fa";
import { API_BASE_URL } from "../services/api";
import { AdminShellContext } from "./AdminShellContext";
import styles from "./Sidebar.module.css";
import alumniStyles from "./AdminShellAlumni.module.css";

// Existing pages supply their header through this adapter when rendered inside
// the persistent Alumni layout. Employer and Registrar retain their own shells.
function AdminPage({ title, subtitle, eyebrow = "Security Gate", onLogout, children, setHeader }) {
    const logoutRef = useRef(onLogout);
    useLayoutEffect(() => { logoutRef.current = onLogout; });
    const logout = useCallback(() => logoutRef.current?.(), []);
    const hasLogout = Boolean(onLogout);
    useLayoutEffect(() => {
        setHeader({ title, subtitle, eyebrow, onLogout: hasLogout ? logout : undefined });
    }, [setHeader, title, subtitle, eyebrow, hasLogout, logout]);
    return children;
}

export default function AdminShell(props) {
    const setHeader = useContext(AdminShellContext);
    return setHeader && props.scope === "alumni"
        ? <AdminPage {...props} setHeader={setHeader} />
        : <StandaloneAdminShell {...props} />;
}

function StandaloneAdminShell({ scope, title, subtitle, eyebrow = "Security Gate", onLogout, children }) {
    const base = `/admin/${scope}`;
    const isRegistrar = scope === "registrar";
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const currentUser = useMemo(() => {
        try {
            return JSON.parse(localStorage.getItem("user") || "null");
        } catch {
            return null;
        }
    }, []);
    usePortalDrawer({ open: mobileNavOpen, onClose: () => setMobileNavOpen(false) });


    const toAbsoluteUploadUrl = (url) => {
        if (!url) return "";
        if (url.startsWith("data:") || url.startsWith("http://") || url.startsWith("https://")) {
            return url;
        }
        if (url.startsWith("/uploads/")) {
            return `${API_BASE_URL.replace(/\/api$/, "")}${url}`;
        }
        return url;
    };

    const adminAvatarUrl = toAbsoluteUploadUrl(currentUser?.admin_avatar_url || "");
    const adminInitial = (currentUser?.name || "A").trim().charAt(0).toUpperCase() || "A";
    const sidebarTitleByScope = {
        alumni: "System",
        employer: "System",
        registrar: "Registrar"
    };
    const itemsByScope = {
        alumni: [
            { label: "Dashboard", path: "", end: true, icon: <FaTachometerAlt /> },
            { label: "Alumni Records", path: "users", icon: <FaUsers /> },
            { label: "Messages", path: "messages", icon: <FaEnvelope /> },
            { label: "Post Announcement ", path: "moderation", icon: <FaBullhorn /> },
            { label: "System Logs", path: "logs", icon: <FaClipboardList /> },
            { label: "Profile", path: "settings", icon: <FaUser /> }
        ],
        employer: [
            { label: "Dashboard", path: "", end: true, icon: <FaTachometerAlt /> },
            { label: "Verification History", path: "verification", icon: <FaUserCheck /> },
            { label: "Manage Posted Jobs", path: "applicants", icon: <FaUsers /> },
            { label: "Messages", path: "messages", icon: <FaEnvelope /> },
            { label: "Post Job", path: "moderation", icon: <FaBriefcase /> },
            { label: "System Logs", path: "logs", icon: <FaClipboardList /> },
            { label: "Profile", path: "settings", icon: <FaUser /> }
        ],
        registrar: [
            { label: "Dashboard", path: "", end: true, icon: <FaTachometerAlt /> },
            { label: "Verification History", path: "verification", icon: <FaUserCheck /> },
            { label: "Alumni Records", path: "records", icon: <FaUsers /> },
            { label: "Profile", path: "settings", icon: <FaUser /> }
        ]
    };
    const items = itemsByScope[scope] || itemsByScope.alumni;
    const sidebarTitle = sidebarTitleByScope[scope] || "System";

    const shellClass = scope === "alumni"
        ? `${styles.adminShell} ${alumniStyles.alumniShell}`
        : styles.adminShell;

    return (
        <div className={`${shellClass} admin-employer-shell admin-shell-root`}>
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
                    <div className={styles.sidebarTitle}>{sidebarTitle}</div>
                    {isRegistrar ? (
                        <div className="registrar-sidebar-copy">
                            <strong>Registrar Dashboard</strong>
                            <p>Manage alumni records and verifications</p>
                        </div>
                    ) : null}
                    <nav className={styles.sidebarNav}>
                        {items.map((item) => {
                            const to = item.path ? `${base}/${item.path}` : base;
                            return (
                                <NavLink
                                    key={item.label}
                                    to={to}
                                    end={item.end}
                                    onClick={() => setMobileNavOpen(false)}
                                    className={({ isActive }) =>
                                        `${styles.navItem}${isActive ? " active" : ""}`
                                    }
                                >
                                    <span className={styles.navIcon}>{item.icon}</span>
                                    {item.label}
                                </NavLink>
                            );
                        })}
                        {onLogout && (
                            <button
                                type="button"
                                className={`${styles.navItem} ${styles.sidebarLogoutBtn}`}
                                onClick={() => {
                                    setMobileNavOpen(false);
                                    onLogout();
                                }}
                            >
                                <span className={styles.navIcon}>
                                    <FaSignOutAlt />
                                </span>
                                Logout
                            </button>
                        )}
                    </nav>
                </div>
            </aside>

            <main className={styles.main}>
                <header className="admin-employer-header">
                    <div className="admin-employer-header-copy">
                        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
                        <h1>{title}</h1>
                        <p className="subtext">{subtitle}</p>
                    </div>

                    <div className="admin-employer-header-profile" aria-label="Admin profile">
                        <div
                            className={`admin-employer-header-avatar${adminAvatarUrl ? " has-photo" : ""}`}
                            style={adminAvatarUrl ? { backgroundImage: `url(${adminAvatarUrl})` } : undefined}
                        >
                            {!adminAvatarUrl && adminInitial}
                        </div>
                    </div>
                </header>

                {children}
            </main>
        </div>
    );
}
