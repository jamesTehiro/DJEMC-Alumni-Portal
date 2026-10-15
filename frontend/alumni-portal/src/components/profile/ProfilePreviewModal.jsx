import React, { useEffect, useRef, useState, useCallback } from "react";
import { FiX, FiLock, FiBriefcase } from "react-icons/fi";
import { api, resolveFileUrl } from "../../services/api";
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
    const profileRequestRef = useRef(0);

    const fetchProfile = useCallback(async () => {
        if (!userId) return;
        const requestId = ++profileRequestRef.current;
        setLoading(true);
        setProfile(null);
        setError("");
        try {
            const data = await api.get(`/profile/${userId}/preview`, true);
            if (requestId === profileRequestRef.current) setProfile(data);
        } catch (err) {
            if (requestId === profileRequestRef.current) setError(err.message || "Unable to load the profile preview.");
        } finally {
            if (requestId === profileRequestRef.current) setLoading(false);
        }
    }, [userId]);

    useEffect(() => {
        fetchProfile();
        return () => { profileRequestRef.current += 1; };
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
        return resolveFileUrl(profile.admin_avatar_url || profile.AlumniProfile?.avatar_url || profile.EmployerProfile?.logo_url || "");
    };

    const getRoleLabel = () => {
        if (!profile) return "";
        if (profile.role === "admin") return "Admin";
        if (profile.role === "employer") return "Employer";
        if (profile.role === "alumni") return "Alumni";
        return "User";
    };

    const renderEmploymentHistory = () => {
        const histories = Array.isArray(profile?.AlumniProfile?.EmploymentHistories) ? profile.AlumniProfile.EmploymentHistories : [];
        if (profile?.role !== "alumni" && !histories.length) return null;
        return (
            <div className="profile-preview-timeline">
                <div className="profile-preview-timeline-title">Employment History</div>
                {profile.isPrivate ? <div className="profile-preview-private-message"><FiLock aria-hidden="true" /><p>Employment history is private.</p></div> : histories.length === 0 ? <p>No employment history to show.</p> : histories.map((item) => (
                    <div className="profile-preview-timeline-item" key={item.id}>
                        <div className="profile-preview-timeline-dot" />
                        <div className="profile-preview-timeline-company">{item.company_name}</div>
                        <div className="profile-preview-timeline-position">{item.position}</div>
                        <div className="profile-preview-timeline-years">
                            {item.start_year ? `${item.start_year} - ${item.end_year || "Present"}` : "Dates not provided"}
                            {item.employment_type ? ` · ${item.employment_type}` : ""}
                        </div>
                    </div>
                ))}
            </div>
        );
    };

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
                            <button type="button" onClick={fetchProfile}>Retry</button>
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
                                <span className="profile-preview-badge">
                                    <FiBriefcase size={12} aria-hidden="true" />
                                    {getRoleLabel()}
                                </span>
                            </div>
                            <div className="profile-preview-details">{renderEmploymentHistory()}</div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
