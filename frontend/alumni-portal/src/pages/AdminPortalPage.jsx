import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FiMail, FiUser } from "react-icons/fi";
import { api } from "../services/api";
import useRenderDebug from "../hooks/useRenderDebug";
import useStrictSafeEffect from "../hooks/useStrictSafeEffect";
import PasswordField from "../components/PasswordField";
import BackToHome from "../components/BackToHome";
import LoginButton from "../components/ui/LoginButton";
import "./AuthPage.css";

export default function AdminPortalPage() {
    useRenderDebug("AdminPortalPage");
    const navigate = useNavigate();
    const [mode, setMode] = useState("login"); // "login" | "create"
    const [setupStatus, setSetupStatus] = useState(null);
    const [setupForm, setSetupForm] = useState({
        name: "",
        email: "",
        password: "",
        admin_scope: "registrar",
        bootstrap_secret: ""
    });
    const [loginForm, setLoginForm] = useState({ email: "", password: "" });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [message, setMessage] = useState("");
    const hasInitializedPanel = useRef(false);

    const currentUser = useMemo(() => {
        try {
            return JSON.parse(localStorage.getItem("user") || "null");
        } catch {
            return null;
        }
    }, []);

    const loadSetupStatus = async () => {
        try {
            const setupSecret = String(setupForm.bootstrap_secret || "").trim();
            if (!setupSecret) {
                setSetupStatus(null);
                return null;
            }

            const data = await api.get("/auth/admin-setup-status", false, {
                headers: { "x-bootstrap-secret": setupSecret }
            });
            setSetupStatus(data);

            const roleOptions = [
                { value: "registrar", disabled: !!data.registrarAdminExists },
                { value: "employer", disabled: !!data.employerAdminExists },
                { value: "alumni", disabled: !!data.alumniAdminExists }
            ];
            const firstAvailable = roleOptions.find((opt) => !opt.disabled)?.value;
            if (firstAvailable) {
                setSetupForm((prev) => ({
                    ...prev,
                    admin_scope: firstAvailable
                }));
            }
            return data;
        } catch (err) {
            setError(err.message);
            return null;
        }
    };

    useStrictSafeEffect(
        "AdminPortalPage:init",
        () => {
            const init = async () => {
                await loadSetupStatus();
                if (currentUser?.role === "admin") {
                    if (currentUser.admin_scope === "employer") navigate("/admin/employer");
                    else if (currentUser.admin_scope === "registrar") navigate("/admin/registrar");
                    else navigate("/admin/alumni");
                }
            };

            init();
            return undefined;
        },
        [],
        { label: "AdminPortalPage init" }
    );

    useEffect(() => {
        if (!setupStatus) return;
        const canCreate = !setupStatus.setupComplete;
        if (!hasInitializedPanel.current) {
            setMode(canCreate ? "create" : "login");
            hasInitializedPanel.current = true;
        } else if (!canCreate) {
            setMode("login");
        }
    }, [setupStatus]);

    useEffect(() => {
        const setupSecret = String(setupForm.bootstrap_secret || "").trim();
        if (!setupSecret) {
            setSetupStatus(null);
            return undefined;
        }

        const timeoutId = window.setTimeout(() => {
            loadSetupStatus();
        }, 250);

        return () => window.clearTimeout(timeoutId);
    }, [setupForm.bootstrap_secret]);

    const onSetupChange = (e) => {
        setSetupForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
    };

    const onLoginChange = (e) => {
        setLoginForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
    };

    const switchToCreate = () => setMode("create");
    const switchToLogin = () => setMode("login");

    const createAdmin = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError("");
        setMessage("");
        try {
            const setupSecret = String(setupForm.bootstrap_secret || "").trim();
            await api.post("/auth/admin-setup", setupForm, false, setupSecret ? { headers: { "x-bootstrap-secret": setupSecret } } : {});
            setMessage("Admin account created. Please sign in.");
            setSetupForm((prev) => ({ ...prev, name: "", email: "", password: "", admin_scope: prev.admin_scope }));
            await loadSetupStatus();
            setMode("login");
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const loginAdmin = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError("");
        setMessage("");
        try {
            const data = await api.post("/auth/login", loginForm);
            if (data.user?.role !== "admin") {
                throw new Error("This portal is for admin accounts only.");
            }
            localStorage.setItem("token", data.token);
            localStorage.setItem("user", JSON.stringify(data.user));

            if (data.user.admin_scope === "employer") navigate("/admin/employer");
            else if (data.user.admin_scope === "registrar") navigate("/admin/registrar");
            else navigate("/admin/alumni");
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const registrarExists = !!setupStatus?.registrarAdminExists;
    const alumniExists = !!setupStatus?.alumniAdminExists;
    const employerExists = !!setupStatus?.employerAdminExists;
    const roleOptions = [
        { value: "registrar", label: "Registrar Officer", disabled: registrarExists },
        { value: "alumni", label: "Alumni Coordinator", disabled: alumniExists },
        { value: "employer", label: "Employer Manager", disabled: employerExists }
    ];
    const canCreateAdmin = !(registrarExists && alumniExists && employerExists);

    return (
        <div className="auth-shell">
            <BackToHome />
            <div className="auth-card">
                <div className="auth-card-header">
                    <h1>Admin Portal</h1>
                    <p>Administrator access only</p>
                </div>
                {error && <p className="auth-error">{error}</p>}
                {message && <p className="auth-success">{message}</p>}

                {mode === "create" && canCreateAdmin ? (
                    <form className="auth-form" onSubmit={createAdmin}>
                        <label className="field">
                            <span>Secret Password</span>
                            <label className="line-input">
                                <PasswordField
                                    name="bootstrap_secret"
                                    value={setupForm.bootstrap_secret}
                                    onChange={onSetupChange}
                                    placeholder="Enter one-time setup secret"
                                    required
                                />
                            </label>
                        </label>
                        <label className="field">
                            <span>Name</span>
                            <label className="line-input">
                                <input
                                    name="name"
                                    value={setupForm.name}
                                    onChange={onSetupChange}
                                    placeholder="Admin Name"
                                    required
                                />
                                <FiUser className="input-icon" />
                            </label>
                        </label>
                        <label className="field">
                            <span>Gmail</span>
                            <label className="line-input">
                                <input
                                    type="email"
                                    name="email"
                                    value={setupForm.email}
                                    onChange={onSetupChange}
                                    placeholder="example@gmail.com"
                                    required
                                />
                                <FiMail className="input-icon" />
                            </label>
                        </label>
                        <label className="field">
                            <span>Password</span>
                            <PasswordField
                                name="password"
                                value={setupForm.password}
                                onChange={onSetupChange}
                                placeholder="Create a strong password"
                                required
                            />
                        </label>
                        <label className="field">
                            <span>Role</span>
                            <label className="role-select-wrap">
                                <select
                                    name="admin_scope"
                                    value={setupForm.admin_scope}
                                    onChange={onSetupChange}
                                    disabled={!canCreateAdmin}
                                    required
                                >
                                    {roleOptions.map((opt) => (
                                        <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                                            {opt.label}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        </label>
                        <LoginButton loading={loading || !canCreateAdmin} />
                        <p className="auth-footer">
                            Already have an account?{" "}
                            <button type="button" className="inline-link-btn" onClick={switchToLogin}>
                                Sign in
                            </button>
                        </p>
                    </form>
                ) : (
                    <form className="auth-form" onSubmit={loginAdmin}>
                        <label className="field">
                            <span>Email Address</span>
                            <label className="line-input">
                                <input
                                    type="email"
                                    name="email"
                                    value={loginForm.email}
                                    onChange={onLoginChange}
                                    placeholder="admin@example.com"
                                    required
                                />
                                <FiMail className="input-icon" />
                            </label>
                        </label>
                        <label className="field">
                            <span>Password</span>
                            <PasswordField
                                name="password"
                                value={loginForm.password}
                                onChange={onLoginChange}
                                placeholder="Password"
                                required
                            />
                        </label>
                        <div className="auth-form-actions">
                            <button type="button" className="inline-link-btn" onClick={() => navigate("/forgot-password?role=admin")}>
                                Forgot Password?
                            </button>
                        </div>
                        <LoginButton loading={loading} />
                        {canCreateAdmin && (
                            <p className="auth-footer">
                                New admin?{" "}
                                <button type="button" className="inline-link-btn" onClick={switchToCreate}>
                                    Create account
                                </button>
                            </p>
                        )}
                    </form>
                )}

                {!canCreateAdmin && mode === "create" && (
                    <p className="auth-footer" style={{ textAlign: "center", marginTop: "16px" }}>
                        Admin accounts are already configured.{" "}
                        <button type="button" className="inline-link-btn" onClick={switchToLogin}>
                            Sign in
                        </button>
                    </p>
                )}
            </div>
        </div>
    );
}