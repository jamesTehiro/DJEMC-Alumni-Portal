import React from "react";
import { NavLink } from "react-router-dom";
import { FiMenu, FiX } from "react-icons/fi";
import usePortalDrawer from "../hooks/usePortalDrawer";
import { FaSignOutAlt } from "react-icons/fa";
import styles from "./Sidebar.module.css";

/**
 * Reusable Sidebar component - Visual reference from Employer Portal sidebar
 * 
 * @param {Object} props
 * @param {string} props.scope - "employer" | "admin-employer" | "admin-alumni" | "registrar"
 * @param {string} props.title - Sidebar title (e.g., "Navigation", "System", "Registrar")
 * @param {Array} props.navItems - Array of { label, path, end, icon } navigation items
 * @param {Function} props.onLogout - Logout callback function
 * @param {React.ReactNode} props.children - Page content to render in main area
 */
export default function Sidebar({ scope = "employer", title = "Navigation", navItems = [], onLogout, children }) {
    const [mobileNavOpen, setMobileNavOpen] = React.useState(false);
    const base = `/${scope === "employer" ? "" : `admin/${scope}`}`;

    usePortalDrawer({ open: mobileNavOpen, onClose: () => setMobileNavOpen(false) });


    return (
        <div className={styles.sidebarLayout}>
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
                    <div className={styles.sidebarTitle}>{title}</div>
                    <nav className={styles.sidebarNav}>
                        {navItems.map((item) => {
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
                                    {item.icon ? (
                                        <span className={styles.navIcon}>{item.icon}</span>
                                    ) : null}
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
                                    <FaSignOutAlt aria-hidden="true" />
                                </span>
                                Logout
                            </button>
                        )}
                    </nav>
                </div>
            </aside>

            <div className={styles.main}>
                {children}
            </div>
        </div>
    );
}