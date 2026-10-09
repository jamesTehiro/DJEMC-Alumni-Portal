import React, { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { API_BASE_URL, api } from "../services/api";
import AdminShell from "../components/AdminShell";
import useRenderDebug from "../hooks/useRenderDebug";
import useStrictSafeEffect from "../hooks/useStrictSafeEffect";
import "./AdminEmployerPage.css";


const SETTINGS_KEY = "registrar_dashboard_settings";

const defaultSettings = {
    registrar_name: "Registrar Admin",
    registrar_email: "",
    office_name: "Registrar's Office",
    auto_refresh_queue: "Enabled",
    default_queue_filter: "Pending only",
    confirm_before_reject: "Enabled",
    matching_mode: "Full name + batch year",
    require_exact_name: "Enabled",
    fallback_to_first_match: "Enabled",
    email_on_new_pending: "Enabled",
    email_on_review_action: "Enabled",
    daily_summary: "Disabled"
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

export default function RegistrarSettingsPage() {
    useRenderDebug("RegistrarSettingsPage");
    const navigate = useNavigate();
    const user = useMemo(() => {
        try {
            return JSON.parse(localStorage.getItem("user") || "null");
        } catch {
            return null;
        }
    }, []);
    const isAllowed = user?.role === "admin" && user?.admin_scope === "registrar";
    const [settings, setSettings] = useState(() => {
        try {
            return {
                ...defaultSettings,
                ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null")
            };
        } catch {
            return defaultSettings;
        }
    });
    const [profileForm, setProfileForm] = useState({
        adminName: "",
        department: "",
        photoPreview: ""
    });
    const [profileEditing, setProfileEditing] = useState(false);
    const [profileSaving, setProfileSaving] = useState(false);
    const [message, setMessage] = useState("");
    const [error, setError] = useState("");

    useStrictSafeEffect(
        `RegistrarSettingsPage:profile:${isAllowed}`,
        () => {
            if (!isAllowed) return undefined;

            const loadProfile = async () => {
                try {
                    const data = await api.get("/profile", true);
                    const cachedUser = (() => {
                        try {
                            return JSON.parse(localStorage.getItem("user") || "null");
                        } catch {
                            return null;
                        }
                    })();

                    const nextName = data?.name || cachedUser?.name || user?.name || "";
                    const nextDepartment =
                        data?.admin_department || cachedUser?.admin_department || user?.admin_department || "Registrar Office";
                    const nextPhoto = toAbsoluteUploadUrl(
                        data?.admin_avatar_url || cachedUser?.admin_avatar_url || user?.admin_avatar_url || ""
                    );

                    setProfileForm({
                        adminName: nextName,
                        department: nextDepartment,
                        photoPreview: nextPhoto
                    });
                    setSettings((prev) => ({
                        ...prev,
                        registrar_name: nextName || prev.registrar_name,
                        registrar_email: data?.email || cachedUser?.email || user?.email || prev.registrar_email,
                        office_name: nextDepartment || prev.office_name
                    }));

                    if (data) {
                        localStorage.setItem(
                            "user",
                            JSON.stringify({
                                ...(cachedUser || user || {}),
                                ...data,
                                admin_department: nextDepartment,
                                admin_avatar_url: nextPhoto
                            })
                        );
                    }
                } catch {
                    setProfileForm({
                        adminName: user?.name || "",
                        department: user?.admin_department || "Registrar Office",
                        photoPreview: toAbsoluteUploadUrl(user?.admin_avatar_url || "")
                    });
                }
            };

            loadProfile();
            return undefined;
        },
        [isAllowed, user],
        { label: "Registrar settings profile init" }
    );

    const handleLogout = () => {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        navigate("/");
    };

    const handleChange = (event) => {
        const { name, value } = event.target;
        setSettings((prev) => ({ ...prev, [name]: value }));
    };

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

    const handleSave = (event) => {
        event.preventDefault();
        localStorage.setItem(
            SETTINGS_KEY,
            JSON.stringify({
                ...settings,
                registrar_name: profileForm.adminName || settings.registrar_name,
                office_name: profileForm.department || settings.office_name
            })
        );
        setMessage("Registrar settings saved.");
        setError("");
    };

    const handleProfileSave = async () => {
        setMessage("");
        setError("");
        setProfileSaving(true);
        try {
            const payload = {
                name: profileForm.adminName,
                email: settings.registrar_email || user?.email,
                admin_department: profileForm.department,
                admin_avatar_url: profileForm.photoPreview
            };
            const res = await api.put("/profile", payload, true);
            const savedUser = res?.user || null;
            const nextPhoto = toAbsoluteUploadUrl(savedUser?.admin_avatar_url || profileForm.photoPreview || "");
            const nextName = savedUser?.name || profileForm.adminName;
            const nextDepartment = savedUser?.admin_department || profileForm.department;
            const nextEmail = savedUser?.email || settings.registrar_email || user?.email || "";

            setProfileForm({
                adminName: nextName,
                department: nextDepartment,
                photoPreview: nextPhoto
            });
            setSettings((prev) => ({
                ...prev,
                registrar_name: nextName || prev.registrar_name,
                registrar_email: nextEmail,
                office_name: nextDepartment || prev.office_name
            }));

            localStorage.setItem(
                "user",
                JSON.stringify({
                    ...(user || {}),
                    ...(savedUser || {}),
                    admin_department: nextDepartment,
                    admin_avatar_url: nextPhoto
                })
            );

            setMessage("Registrar profile saved.");
            setProfileEditing(false);
        } catch (err) {
            setError(err.message);
        } finally {
            setProfileSaving(false);
        }
    };

    if (!isAllowed) {
        return (
            <div className="admin-employer-shell">
                <div className="admin-employer-center">
                    <div className="admin-employer-card">
                        <h3>Registrar Admin Access Only</h3>
                        <p>Please log in using a Registrar Admin account.</p>
                        <Link to="/admin/login">Go to Login</Link>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <AdminShell
            scope="registrar"
            title="Profile"
            subtitle="Adjust registrar profile details and working preferences for queue review and record matching."
            eyebrow="Registrar Console"
            onLogout={handleLogout}
        >
            {message && <p className="notice success">{message}</p>}
            {error && <p className="notice error">{error}</p>}

            <div className="registrar-settings-grid">
                <section className="settings-profile-card">
                    <div className="panel-header">
                        <h2>Registrar Profile</h2>
                        <span>Identity and office details</span>
                    </div>

                    {!profileEditing ? (
                        <div className="settings-profile-view">
                            <div className="settings-profile-top">
                                <div
                                    className={`settings-profile-avatar ${profileForm.photoPreview ? "has-photo" : ""}`}
                                    style={profileForm.photoPreview ? { backgroundImage: `url(${profileForm.photoPreview})` } : undefined}
                                >
                                    {!profileForm.photoPreview && (profileForm.adminName || settings.registrar_name || "R").charAt(0).toUpperCase()}
                                </div>

                                <div className="settings-profile-meta">
                                    <h4>{profileForm.adminName || settings.registrar_name || "Registrar Admin"}</h4>
                                    <p>{profileForm.department || settings.office_name || "Registrar Office"}</p>
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
                                    {!profileForm.photoPreview && (profileForm.adminName || "R").charAt(0).toUpperCase()}
                                </div>

                                <div className="settings-profile-meta">
                                    <h4>{profileForm.adminName || "Registrar Admin"}</h4>
                                    <p>{profileForm.department || "Registrar Office"}</p>
                                    <span>Upload a new photo or update registrar office details below.</span>
                                </div>
                            </div>

                            <div className="form-stack">
                                <label className="field">
                                    <span>Display Name</span>
                                    <input
                                        className="saas-input"
                                        name="adminName"
                                        value={profileForm.adminName}
                                        onChange={handleProfileChange}
                                        placeholder="Enter registrar admin name"
                                    />
                                </label>
                                <label className="field">
                                    <span>Contact Email</span>
                                    <input
                                        className="saas-input"
                                        name="registrar_email"
                                        value={settings.registrar_email}
                                        onChange={handleChange}
                                        placeholder="Enter registrar contact email"
                                    />
                                </label>
                                <label className="field">
                                    <span>Office Name</span>
                                    <input
                                        className="saas-input"
                                        name="department"
                                        value={profileForm.department}
                                        onChange={handleProfileChange}
                                        placeholder="Registrar Office"
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
                                            setError("");
                                            setMessage("");
                                        }}
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </section>
            </div>
        </AdminShell>
    );
}
