import React, { useEffect, useState, useCallback } from "react";
import { FiX, FiLock, FiBriefcase, FiMapPin, FiCalendar, FiBookOpen } from "react-icons/fi";
import { api } from "../../services/api";
import "./ProfilePreviewModal.css";

/**
 * ProfilePreviewModal - A centered modal that fetches and displays a user's
 * profile preview from the backend. Respects privacy settings server-side.
 *
 * Props:
 *   userId   - The ID of the user to preview
 *   onClose  - Callback to close the modal
 */
export default function ProfilePreviewModal({ userId, onClose }) {
    const [profile, setProfile] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const fetchProfile = useCallback(async () => {
        if (!userId) return;
        setLoading(true);
        setError("");
        try {
            const data = await api.get(`/profile/${userId}/preview`, true);
            setProfile(data);
        } catch (err) {
            setError(err.message || String(err));
        } finally {
            setLoading(false);
        }
    }, [userId]);

    useEffect(() => {
        fetchProfile();
    }, [fetchProfile]);

    // Close on Escape
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === "Escape") {
                onClose();
            }
        };
        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [onClose]);

    // Close on overlay click
    const handleOverlayClick = (e) => {
        if (e.target === e.currentTarget) {
            onClose();
        }
    };

    const getAvatarUrl = () => {
        if (!profile) return "";
        if (profile.admin_avatar_url) return profile.admin_avatar_url;
        if (profile.AlumniProfile?.avatar_url) return profile.AlumniProfile.avatar_url;
        if (profile.EmployerProfile?.logo_url) return profile.EmployerProfile.logo_url;
        return "";
    };

    const getRoleLabel = () => {
        if (!profile) return "";
        if (profile.role === "admin" && profile.admin_scope) {
            return `Admin · ${profile.admin_scope.charAt(0).toUpperCase() + profile.admin_scope.slice(1)}`;
        }
        if (profile.role === "admin") return "Admin";
        if (profile.role === "employer") return "Employer";
        return "Alumni";
    };

    const formatEmploymentStatus = (status) => {
        if (!status) return null;
        const map = {
            employed: "Employed",
            unemployed: "Unemployed",
            "self-employed": "Self-Employed"
        };
        return map[status] || status;
    };

    const renderDetailItem = (label, value) => {
        if (!value) return null;
        return (
            <div className="profile-preview-detail-item" key={label}>
                <span className="profile-preview-detail-label">{label}</span>
                <span className="profile-preview-detail-value">{value}</span>
            </div>
        );
    };

    const renderEmploymentHistory = () => {
        const histories = profile?.AlumniProfile?.EmploymentHistories;
        if (!histories || histories.length === 0) return null;
        return (
            <div className="profile-preview-timeline">
                <div className="profile-preview-timeline-title">Employment History</div>
                {histories.map((item) => (
                    <div className="profile-preview-timeline-item" key={item.id}>
                        <div className="profile-preview-timeline-dot" />
                        <div className="profile-preview-timeline-company">{item.company_name}</div>
                        <div className="profile-preview-timeline-position">{item.position}</div>
                        <div className="profile-preview-timeline-years">
                            {item.start_year}{item.end_year ? ` - ${item.end_year}` : " - Present"}
                            {item.employment_type ? ` · ${item.employment_type}` : ""}
                        </div>
                    </div>
                ))}
            </div>
        );
    };

    const renderPublicProfile = () => {
        const ap = profile?.AlumniProfile;
        const ep = profile?.EmployerProfile;
        return (
            <div className="profile-preview-details">
                {renderDetailItem("Address", ap?.address)}
                {renderDetailItem("Graduation Year", ap?.graduation_year)}
                {renderDetailItem("Course", ap?.course)}
                {renderDetailItem("Employment Status", formatEmploymentStatus(ap?.employment_status))}
                {renderDetailItem("Current Company", ap?.current_company)}
                {renderDetailItem("Current Position", ap?.job_title)}
                {ep?.organization_name && renderDetailItem("Organization", ep.organization_name)}
                {ep?.industry && renderDetailItem("Industry", ep.industry)}
                {renderEmploymentHistory()}
            </div>
        );
    };

    const renderPrivateProfile = () => (
        <div className="profile-preview-private-message">
            <FiLock size={20} style={{ marginBottom: 8 }} />
            <p style={{ margin: 0 }}>
                This alumni has chosen to keep their profile private.
            </p>
        </div>
    );

    return (
        <div className="profile-preview-modal-overlay" onClick={handleOverlayClick}>
            <div className="profile-preview-modal" role="dialog" aria-modal="true" aria-label="Profile Preview">
                <div className="profile-preview-modal-header">
                    <h3>Profile Preview</h3>
                    <button
                        type="button"
                        className="profile-preview-modal-close"
                        onClick={onClose}
                        aria-label="Close"
                    >
                        <FiX />
                    </button>
                </div>
                <div className="profile-preview-modal-body">
                    {loading && (
                        <div className="profile-preview-loading">
                            <span>Loading profile...</span>
                        </div>
                    )}
                    {error && (
                        <div className="profile-preview-error">
                            {error}
                            {!error.includes("preview") && !error.includes("profile") && (
                                <span style={{ display: "block", marginTop: 6, opacity: 0.8 }}>
                                    URL: /profile/{userId}/preview
                                </span>
                            )}
                        </div>
                    )}
                    {!loading && !error && profile && (
                        <>
                            <div className="profile-preview-avatar-section">
                                <div className={`profile-preview-avatar ${getAvatarUrl() ? "has-photo" : ""}`}>
                                    {getAvatarUrl() ? (
                                        <img src={getAvatarUrl()} alt={profile.name || "Profile"} />
                                    ) : (
                                        (profile.name || "U")[0]?.toUpperCase()
                                    )}
                                </div>
                                <h4 className="profile-preview-name">{profile.name}</h4>
                                {profile.isPrivate ? (
                                    <span className="profile-preview-private-badge">
                                        <FiLock size={12} />
                                        Private Profile
                                    </span>
                                ) : (
                                    <span className="profile-preview-badge">
                                        <FiBriefcase size={12} />
                                        {getRoleLabel()}
                                    </span>
                                )}
                            </div>
                            {profile.isPrivate ? renderPrivateProfile() : renderPublicProfile()}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}