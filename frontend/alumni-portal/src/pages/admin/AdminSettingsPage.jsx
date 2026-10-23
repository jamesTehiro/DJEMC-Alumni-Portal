import React, { useMemo, useRef, useState } from "react";
import { Modal } from "react-bootstrap";
import { Link, useNavigate } from "react-router-dom";
import { API_BASE_URL, api } from "../../services/api";
import useRenderDebug from "../../hooks/useRenderDebug";
import useStrictSafeEffect from "../../hooks/useStrictSafeEffect";
import AdminShell from "../../components/AdminShell";
import SectionHeader from "../../components/ui/SectionHeader";
import { ADMIN_SCOPE_META, clearSessionAndGoHome, getStoredUser, isAllowedAdminScope } from "./adminUtils";
import "../AdminEmployerPage.css";

const SETTINGS_STORAGE_KEY = {
    alumni: "admin_alumni_settings_preferences",
    employer: "admin_employer_settings_preferences"
};

const SETTINGS_DEFAULTS = {
    alumni: {
        account_reactivation: "Enabled",
        reset_password_trigger: "Email reset link",
        profile_change_review: "Manual approval",
        flagged_profile_lock: "Enabled",
        data_visibility: "Admin managed",
        resume_visibility: "Verified alumni only",
        consent_tracking: "Enabled",
        posting_access: "Verified alumni only",
        messaging_access: "Verified alumni only",
        application_access: "Verified alumni only",
        archive_inactive: "After 12 months",
        export_format: "CSV",
        import_mode: "Manual review",
        warning_template: "Professional reminder",
        announcement_preference: "In-app + email",
        summary_delivery: "Weekly digest",
        audit_recent_actions: "Enabled",
        login_history: "Enabled",
        record_change_history: "Enabled"
    },
    employer: {
        account_reactivation: "Enabled",
        posting_rights: "Manual restore",
        deletion_flow: "Soft delete review",
        job_auto_approval: "Disabled",
        review_requirement: "Manual review required",
        posting_limit: "25 active jobs",
        required_documents: "Business permit only",
        verification_rule: "Verified before posting",
        renewal_reminder: "30 days before expiry",
        messaging_control: "Admin and applicants only",
        admin_only_restrictions: "Warnings escalate first",
        warning_escalation: "3-strike review",
        interview_instruction_default: "Bring resume and IDs",
        interview_required_fields: "Venue, address, date, time, contact info",
        interview_note_template: "Resume, valid ID, portfolio",
        moderation_rule: "Flagged jobs need review",
        banned_keywords: "Configured list",
        hidden_suspended_posts: "Auto-hide suspended",
        activity_logs: "Enabled",
        posting_history: "Enabled",
        warning_history: "Enabled",
        approval_history: "Enabled"
    }
};

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

export default function AdminSettingsPage({ role }) {
    useRenderDebug(`AdminSettingsPage:${role}`);
    const navigate = useNavigate();
    const [users, setUsers] = useState([]);
    const [loadingUsers, setLoadingUsers] = useState(false);
    const [savingUserId, setSavingUserId] = useState(null);
    const [pendingUserAction, setPendingUserAction] = useState(null);
    const [userActionInFlight, setUserActionInFlight] = useState(false);
    const userActionInFlightRef = useRef(false);
    const actionMenuRefs = useRef(new Map());
    const [profileForm, setProfileForm] = useState({
        adminName: "",
        department: "",
        photoPreview: ""
    });
    const [profileSaving, setProfileSaving] = useState(false);
    const [profileEditing, setProfileEditing] = useState(false);
    const [warningForm, setWarningForm] = useState({
        userId: "",
        message: ""
    });
    const [warningSending, setWarningSending] = useState(false);
    const [message, setMessage] = useState("");
    const [error, setError] = useState("");

    const user = useMemo(() => getStoredUser(), []);
    const isAllowed = isAllowedAdminScope(user, role);
    const scopeMeta = ADMIN_SCOPE_META[role];

    useStrictSafeEffect(
        `AdminSettingsPage:users:${role}:${isAllowed}`,
        () => {
            if (!isAllowed) return undefined;

            const loadUsers = async () => {
                setLoadingUsers(true);
                setError("");
                try {
                    const data = await api.get(scopeMeta.usersEndpoint, true);
                    setUsers(Array.isArray(data) ? data.filter((item) => item.role === role) : []);
                } catch (err) {
                    setError(err.message);
                } finally {
                    setLoadingUsers(false);
                }
            };

            loadUsers();
            return undefined;
        },
        [isAllowed, role, scopeMeta.usersEndpoint],
        { label: `AdminSettingsPage users init (${role})` }
    );

    useStrictSafeEffect(
        `AdminSettingsPage:profile:${role}:${isAllowed}`,
        () => {
            if (!isAllowed) return undefined;

            const loadProfile = async () => {
                try {
                    const data = await api.get("/profile", true);
                    const cachedUser = getStoredUser();
                    setProfileForm({
                        adminName: data?.name || cachedUser?.name || user?.name || "",
                        department: data?.admin_department || cachedUser?.admin_department || user?.admin_department || "",
                        photoPreview: toAbsoluteUploadUrl(
                            data?.admin_avatar_url || cachedUser?.admin_avatar_url || user?.admin_avatar_url || ""
                        )
                    });
                    if (data) {
                        localStorage.setItem(
                            "user",
                            JSON.stringify({
                                ...(user || {}),
                                ...data,
                                admin_department: data?.admin_department || cachedUser?.admin_department || user?.admin_department || "",
                                admin_avatar_url: data?.admin_avatar_url || cachedUser?.admin_avatar_url || user?.admin_avatar_url || ""
                            })
                        );
                    }
                    setProfileEditing(false);
                } catch {
                    setProfileForm((prev) => ({
                        ...prev,
                        adminName: user?.name || prev.adminName,
                        department: user?.admin_department || prev.department,
                        photoPreview: toAbsoluteUploadUrl(user?.admin_avatar_url || prev.photoPreview)
                    }));
                }
            };

            loadProfile();
            return undefined;
        },
        [isAllowed, role, user],
        { label: `AdminSettingsPage profile init (${role})` }
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

    const displayUserName = (item) =>
        role === "employer" ? item.EmployerProfile?.organization_name || item.name : item.name;

    const openUserAction = (item, action) => {
        if (userActionInFlightRef.current) return;
        setMessage("");
        setError("");
        setPendingUserAction({ item, action });
    };

    const closeUserAction = () => {
        if (!userActionInFlightRef.current) setPendingUserAction(null);
    };

    const closeActionMenu = (userId) => {
        actionMenuRefs.current.get(String(userId))?.removeAttribute("open");
    };

    const confirmUserAction = async () => {
        const action = pendingUserAction;
        if (!action || userActionInFlightRef.current) return;
        userActionInFlightRef.current = true;
        setUserActionInFlight(true);
        setMessage("");
        setError("");
        setSavingUserId(action.item.id);
        try {
            if (action.action === "reset") {
                await api.post("/auth/forgot-password", { email: action.item.email, role }, false);
                setMessage(`Password reset request submitted for ${displayUserName(action.item)}. The reset link is handled by the existing email queue.`);
            } else {
                const status = action.action === "deactivate" ? "deactivated" : "verified";
                const result = await api.put(`${scopeMeta.usersEndpoint}/${action.item.id}/status`, { status, action: action.action }, true);
                const updated = result?.user;
                if (String(updated?.id) !== String(action.item.id) || updated?.role !== role || updated?.account_status !== status) {
                    throw new Error("The server did not confirm the requested account status. Refresh the list before trying again.");
                }
                setUsers((prev) => prev.map((item) => String(item.id) === String(updated.id)
                    ? {
                        ...item,
                        ...updated,
                        can_reactivate: action.action === "deactivate",
                        EmployerProfile: item.EmployerProfile,
                        AlumniProfile: item.AlumniProfile
                    }
                    : item));
                setMessage(action.action === "deactivate" ? "User deactivated." : "User reactivated.");
            }
            setPendingUserAction(null);
            closeActionMenu(action.item.id);
        } catch (err) {
            setError(err.message || "The requested account action failed.");
        } finally {
            userActionInFlightRef.current = false;
            setUserActionInFlight(false);
            setSavingUserId(null);
        }
    };

    const actionDescription = pendingUserAction?.action === "deactivate"
        ? "This will block the account from protected features. The account and its data will remain in the system."
        : pendingUserAction?.action === "reactivate"
            ? "This will restore verified account access. Pending or rejected accounts cannot be reactivated here."
            : "A single-use password reset link will be requested through the existing email queue. No password will be shown here.";

    const handleProfileChange = (event) => {
        const { name, value } = event.target;
        setProfileForm((prev) => ({ ...prev, [name]: value }));
    };

    const handleProfilePhotoChange = (event) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = () => {
            setProfileForm((prev) => ({
                ...prev,
                photoPreview: String(reader.result || "")
            }));
        };
        reader.readAsDataURL(file);
    };

    const handleProfileSave = async () => {
        setMessage("");
        setError("");
        setProfileSaving(true);
        try {
            const payload = {
                name: profileForm.adminName,
                email: user?.email,
                admin_department: profileForm.department,
                admin_avatar_url: profileForm.photoPreview
            };
            const res = await api.put("/profile", payload, true);
            const savedUser = res?.user || null;
            if (savedUser) {
                const nextPhoto = toAbsoluteUploadUrl(savedUser.admin_avatar_url || profileForm.photoPreview || "");
                localStorage.setItem(
                    "user",
                    JSON.stringify({
                        ...(user || {}),
                        ...savedUser,
                        admin_department: savedUser.admin_department || profileForm.department || "",
                        admin_avatar_url: nextPhoto
                    })
                );
                setProfileForm((prev) => ({
                    ...prev,
                    adminName: savedUser.name || prev.adminName,
                    department: savedUser.admin_department || prev.department,
                    photoPreview: nextPhoto
                }));
            }
            setMessage("Profile saved.");
            setProfileEditing(false);
        } catch (err) {
            setError(err.message);
        } finally {
            setProfileSaving(false);
        }
    };

    const handleWarningChange = (event) => {
        const { name, value } = event.target;
        setWarningForm((prev) => ({ ...prev, [name]: value }));
    };

    const handleSendWarning = async (event) => {
        event.preventDefault();
        setMessage("");
        setError("");
        setWarningSending(true);
        try {
            await api.post(
                scopeMeta.warningsEndpoint,
                {
                    userId: warningForm.userId,
                    message: warningForm.message
                },
                true
            );
            setMessage("Warning sent.");
            setWarningForm({ userId: "", message: "" });
        } catch (err) {
            setError(err.message);
        } finally {
            setWarningSending(false);
        }
    };

    return (
        <AdminShell
            scope={role}
            title={role === "employer" ? "Profile" : "Settings"}
            subtitle={`${scopeMeta.label} admin settings and user management.`}
            onLogout={() => clearSessionAndGoHome(navigate)}
        >
            {message && <p className="notice success">{message}</p>}
            {error && !pendingUserAction && <p className="notice error" role="alert">{error}</p>}

            <Modal show={Boolean(pendingUserAction)} onHide={closeUserAction} centered backdrop={userActionInFlight ? "static" : true} keyboard={!userActionInFlight}>
                <Modal.Header closeButton={!userActionInFlight}>
                    <Modal.Title>
                        {pendingUserAction?.action === "deactivate" ? "Deactivate Account" : pendingUserAction?.action === "reactivate" ? "Reactivate Account" : "Reset Password"}
                    </Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <p>Confirm this action for <strong>{pendingUserAction ? displayUserName(pendingUserAction.item) : ""}</strong> ({pendingUserAction?.item.email}).</p>
                    <p className="mb-0">{actionDescription}</p>
                    {error && <p className="notice error mt-3 mb-0" role="alert">{error}</p>}
                </Modal.Body>
                <Modal.Footer>
                    <button type="button" className="secondary-btn" onClick={closeUserAction} disabled={savingUserId !== null}>Cancel</button>
                    <button type="button" className="primary-btn" onClick={confirmUserAction} disabled={savingUserId !== null}>
                        {savingUserId !== null ? "Processing..." : pendingUserAction?.action === "deactivate" ? "Deactivate" : pendingUserAction?.action === "reactivate" ? "Reactivate" : "Send Reset Link"}
                    </button>
                </Modal.Footer>
            </Modal>

            <section className="content-grid" style={{ gridTemplateColumns: "1fr" }}>
                <div className="settings-profile-card">
                    <SectionHeader title="Profile" meta="Admin identity" />

                    {!profileEditing ? (
                        <div className="settings-profile-view">
                            <div className="settings-profile-top">
                                <div
                                    className={`settings-profile-avatar ${profileForm.photoPreview ? "has-photo" : ""}`}
                                    style={profileForm.photoPreview ? { backgroundImage: `url(${profileForm.photoPreview})` } : undefined}
                                >
                                    {!profileForm.photoPreview && (profileForm.adminName || "A").charAt(0).toUpperCase()}
                                </div>

                                <div className="settings-profile-meta">
                                    <h4>{profileForm.adminName || "Admin Name"}</h4>
                                    <p>{profileForm.department || "Department / Office"}</p>
                                    <span>Profile photo updates appear here after save.</span>
                                </div>

                                <button type="button" className="secondary-btn settings-profile-edit" onClick={() => setProfileEditing(true)}>
                                    Edit Profile
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="settings-profile-form">
                            <div className="settings-profile-top settings-profile-top-edit">
                                <div
                                    className={`settings-profile-avatar ${profileForm.photoPreview ? "has-photo" : ""}`}
                                    style={profileForm.photoPreview ? { backgroundImage: `url(${profileForm.photoPreview})` } : undefined}
                                >
                                    {!profileForm.photoPreview && (profileForm.adminName || "A").charAt(0).toUpperCase()}
                                </div>

                                <div className="settings-profile-meta">
                                    <h4>{profileForm.adminName || "Admin Name"}</h4>
                                    <p>{profileForm.department || "Department / Office"}</p>
                                    <span>Upload a new photo or update your office details below.</span>
                                </div>
                            </div>

                            <div className="form-stack">
                                <label className="field">
                                    <span>Admin name</span>
                                    <input
                                        name="adminName"
                                        className="saas-input"
                                        value={profileForm.adminName}
                                        onChange={handleProfileChange}
                                        placeholder="Enter admin name"
                                    />
                                </label>
                                <label className="field">
                                    <span>Department / Office</span>
                                    <input
                                        name="department"
                                        className="saas-input"
                                        value={profileForm.department}
                                        onChange={handleProfileChange}
                                        placeholder={role === "alumni" ? "Alumni Office" : "Registrar Office"}
                                    />
                                </label>
                                <label className="field">
                                    <span>Profile photo</span>
                                    <input type="file" accept="image/*" className="saas-input" onChange={handleProfilePhotoChange} />
                                </label>

                                <div className="inline-actions settings-profile-actions">
                                    <button type="button" className="primary-btn" onClick={handleProfileSave} disabled={profileSaving}>
                                        {profileSaving ? "Saving..." : "Save Profile"}
                                    </button>
                                    <button
                                        type="button"
                                        className="secondary-btn"
                                        onClick={() => {
                                            setProfileEditing(false);
                                            setMessage("");
                                            setError("");
                                            setProfileForm({
                                                adminName: user?.name || "",
                                                department: user?.admin_department || "",
                                                photoPreview: user?.admin_avatar_url || ""
                                            });
                                        }}
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </section>

            <section className="content-grid">
                <div className="settings-card queue-table-wrap">
                    <SectionHeader title="User Management" meta={loadingUsers ? "Loading..." : `${users.length} Users`} />
                    <div className="queue-table">
                        <div className="queue-row header">
                            <span>Name</span>
                            <span>Email</span>
                            <span>Role</span>
                            <span>Status</span>
                            <span>Actions</span>
                        </div>
                        {users.length === 0 && !loadingUsers && (
                            <div className="queue-row">
                                <span>No users found.</span>
                                <span></span>
                                <span></span>
                                <span></span>
                                <span></span>
                            </div>
                        )}
                        {users.map((item) => (
                            <div className="queue-row" key={item.id}>
                                <span>{displayUserName(item)}</span>
                                <span>{item.email}</span>
                                <span>{scopeMeta.label}</span>
                                <span className="pill">{item.account_status || "pending"}</span>
                                <div className="actions">
                                    <details
                                        className="action-menu"
                                        ref={(node) => {
                                            if (node) actionMenuRefs.current.set(String(item.id), node);
                                            else actionMenuRefs.current.delete(String(item.id));
                                        }}
                                    >
                                        <summary>{role === "employer" ? "Choices" : "..."}</summary>
                                        {String(item.account_status).toLowerCase() === "verified" && <button type="button" className="menu-btn reject" onClick={() => openUserAction(item, "deactivate")} disabled={savingUserId !== null}>
                                            {savingUserId === item.id ? "Updating..." : "Deactivate"}
                                        </button>}
                                        {String(item.account_status).toLowerCase() === "verified" && <button type="button" className="menu-btn approve" disabled title="This account is already active.">Reactivate</button>}
                                        {["deactivated", "suspended"].includes(String(item.account_status).toLowerCase()) && item.can_reactivate && <button type="button" className="menu-btn approve" onClick={() => openUserAction(item, "reactivate")} disabled={savingUserId !== null}>
                                            {savingUserId === item.id ? "Updating..." : "Reactivate"}
                                        </button>}
                                        {["deactivated", "suspended"].includes(String(item.account_status).toLowerCase()) && !item.can_reactivate && <button type="button" className="menu-btn approve" disabled title="The account history does not confirm that this account was verified before it became inactive.">Reactivate (Unavailable)</button>}
                                        <button
                                            type="button"
                                            className="menu-btn request"
                                            onClick={() => openUserAction(item, "reset")}
                                            disabled={savingUserId !== null}
                                        >
                                            {savingUserId === item.id ? "Sending..." : "Reset Password"}
                                        </button>
                                        {role === "employer" && (
                                            <button
                                                type="button"
                                                className="menu-btn reject"
                                                disabled
                                                title="Permanent deletion is unavailable because employer records may have linked jobs, applications, conversations, and documents. Deactivate the account to block access while preserving its data."
                                            >
                                                Delete Account (Unavailable)
                                            </button>
                                        )}
                                    </details>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <aside className="settings-card audit-panel">
                    <h3>Send Warning</h3>
                    <form className="form-stack" onSubmit={handleSendWarning}>
                        <label className="field">
                            <span>Select User</span>
                            <select
                                name="userId"
                                className="saas-input"
                                value={warningForm.userId}
                                onChange={handleWarningChange}
                                required
                            >
                                <option value="">{`Select an ${scopeMeta.lowerLabel}`}</option>
                                {users.map((item) => (
                                    <option key={item.id} value={item.id}>
                                        {displayUserName(item)} - {item.email}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label className="field">
                            <span>Message</span>
                            <textarea
                                name="message"
                                className="saas-textarea"
                                rows="5"
                                value={warningForm.message}
                                onChange={handleWarningChange}
                                placeholder="Write a warning note..."
                                required
                            />
                        </label>
                        <button className="primary-btn" type="submit" disabled={warningSending || !warningForm.userId}>
                            {warningSending ? "Sending..." : "Send Warning"}
                        </button>
                    </form>
                </aside>
            </section>
        </AdminShell>
    );
}
