import React, { useMemo, useState, useCallback } from "react";
import { useEffect } from "react";
import { Row, Col, Card, Button } from "react-bootstrap";
import { FaHome, FaBriefcase, FaUsers, FaEnvelope, FaUser, FaBell, FaSignOutAlt, FaFileAlt } from "react-icons/fa";
import { FiMenu, FiX } from "react-icons/fi";
import { useNavigate, Outlet, useLocation } from "react-router-dom";
import "./DashboardLayout.css";

export default function DashboardLayout() {
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const navigate = useNavigate();
    const location = useLocation();
    const user = useMemo(() => {
        try {
            return JSON.parse(localStorage.getItem("user") || "null");
        } catch {
            return null;
        }
    }, []);
    const isAlumni = user?.role === "alumni";

    useEffect(() => {
        if (typeof window === "undefined") return undefined;

        const media = window.matchMedia("(max-width: 767.98px)");
        const applyMobileState = (matches) => {
            if (!matches) {
                setMobileNavOpen(false);
            }
        };

        applyMobileState(media.matches);

        const handleChange = (event) => applyMobileState(event.matches);
        media.addEventListener("change", handleChange);
        return () => media.removeEventListener("change", handleChange);
    }, []);

    const handleLogout = () => {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        navigate("/");
    };

    const isActive = useCallback((path) => {
        if (path === "/dashboard") {
            return location.pathname === "/dashboard" || location.pathname === "/alumni";
        }
        return location.pathname.startsWith(path);
    }, [location.pathname]);

    const handleNav = (path) => {
        navigate(path);
        setMobileNavOpen(false);
    };

    return (
        <div className="dashboard-layout">
            {/* Overlay for mobile */}
            <div
                className={`employer-sidebar-overlay${mobileNavOpen ? " visible" : ""}`}
                onClick={() => setMobileNavOpen(false)}
                aria-hidden={!mobileNavOpen}
            />

            {/* Mobile nav toggle */}
            <button
                type="button"
                className="employer-mobile-nav-toggle"
                onClick={() => setMobileNavOpen((prev) => !prev)}
                aria-label={mobileNavOpen ? "Close navigation" : "Open navigation"}
                aria-expanded={mobileNavOpen}
            >
                {mobileNavOpen ? <FiX /> : <FiMenu />}
            </button>

            <div className="employer-layout">
                <aside className={`employer-sidebar${mobileNavOpen ? " open" : ""}`}>
                    <div className="employer-sidebar-card">
                        <div className="employer-sidebar-title">Navigation</div>
                        <div className="employer-sidebar-nav">
                            <button
                                type="button"
                                className={`employer-nav-item ${isActive("/dashboard") ? "active" : ""}`}
                                onClick={() => handleNav("/dashboard")}
                            >
                                <FaHome className="dash-icon" />
                                Dashboard
                            </button>
                            <button
                                type="button"
                                className={`employer-nav-item ${isActive("/jobs") ? "active" : ""}`}
                                onClick={() => handleNav("/jobs")}
                            >
                                <FaBriefcase className="dash-icon" />
                                Jobs
                            </button>
                            <button
                                type="button"
                                className={`employer-nav-item ${isActive("/feed") ? "active" : ""}`}
                                onClick={() => handleNav("/feed")}
                            >
                                <FaUsers className="dash-icon" />
                                Feed
                            </button>
                            <button
                                type="button"
                                className={`employer-nav-item ${isActive("/messages") ? "active" : ""}`}
                                onClick={() => handleNav("/messages")}
                            >
                                <FaEnvelope className="dash-icon" />
                                Messages
                            </button>
                            {!isAlumni && (
                                <button
                                    type="button"
                                    className={`employer-nav-item ${isActive("/notifications") ? "active" : ""}`}
                                    onClick={() => handleNav("/notifications")}
                                >
                                    <FaBell className="dash-icon" />
                                    Notifications
                                </button>
                            )}
                            <button
                                type="button"
                                className={`employer-nav-item ${isActive("/profile") ? "active" : ""}`}
                                onClick={() => handleNav("/profile")}
                            >
                                <FaUser className="dash-icon" />
                                Profile
                            </button>
                            <button
                                type="button"
                                className={`employer-nav-item ${isActive("/resume-builder") ? "active" : ""}`}
                                onClick={() => handleNav("/resume-builder")}
                            >
                                <FaFileAlt className="dash-icon" />
                                Resume Builder
                            </button>
                        </div>
                        <div className="employer-sidebar-divider" />
                        <div className="employer-sidebar-nav">
                            <button
                                type="button"
                                className="employer-nav-item"
                                onClick={() => {
                                    setMobileNavOpen(false);
                                    handleLogout();
                                }}
                            >
                                <FaSignOutAlt className="dash-icon" />
                                Logout
                            </button>
                        </div>
                    </div>
                </aside>

                <div className="main-content">
                    <Outlet />
                </div>
            </div>
        </div>
    );
}