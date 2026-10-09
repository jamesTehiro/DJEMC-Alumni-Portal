import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../services/api";
import { FiMail, FiUser } from "react-icons/fi";
import PasswordField from "../components/PasswordField";
import BackToHome from "../components/BackToHome";
import "./AuthPage.css";

export default function AdminCreatePage() {
    const navigate = useNavigate();
    const [bootstrapSecret, setBootstrapSecret] = useState("");
    const [form, setForm] = useState({
        name: "",
        email: "",
        password: "",
        admin_scope: "registrar"
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");
    const [setupStatus, setSetupStatus] = useState(null);

    const currentUser = (() => {
        try {
            return JSON.parse(localStorage.getItem("user") || "null");
        } catch {
            return null;
        }
    })();

    const isAllowed = currentUser?.role === "admin";

    const loadSetupStatus = async () => {
        try {
            const secret = String(bootstrapSecret || "").trim();
            if (!secret) return;
            const data = await api.get("/auth/admin-setup-status", false, {
                headers: { "x-bootstrap-secret": secret }
            });
            setSetupStatus(data);
            const roleOptions = [
                { value: "registrar", disabled: !!data.registrarAdminExists },
                { value: "employer", disabled: !!data.employerAdminExists },
                { value: "alumni", disabled: !!data.alumniAdminExists }
            ];
            const firstAvailable = roleOptions.find((opt) => !opt.disabled)?.value;
            if (firstAvailable) setForm((prev) => ({ ...prev, admin_scope: firstAvailable }));
        } catch { }
    };

    const handleSecretChange = (e) => {
        setBootstrapSecret(e.target.value);
    };

    const handleChange = (e) => {
        setForm({ ...form, [e.target.name]: e.target.value });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError("");
        setSuccess("");
        try {
            const secret = String(bootstrapSecret || "").trim();
            if (!secret) throw new Error("Bootstrap secret is required.");
            await api.post(
                "/auth/admin-setup",
                { ...form, bootstrap_secret: secret },
                false,
                { headers: { "x-bootstrap-secret": secret } }
            );
            setSuccess("Admin account created. You can now sign in.");
            setForm({ name: "", email: "", password: "", admin_scope: "registrar" });
            setTimeout(() => navigate("/admin/login"), 700);
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
        { value: "registrar", label: "Registrar Admin", disabled: registrarExists },
        { value: "employer", label: "Employer Admin", disabled: employerExists },
        { value: "alumni", label: "Alumni Admin", disabled: alumniExists }
    ];
    const canCreateAdmin = !(registrarExists && alumniExists && employerExists);

    if (!isAllowed) {
        return (
            <div className="auth-shell">
                <BackToHome />
                <div className="auth-card">
                    <div className="auth-card-header">
                        <h1>Admin Access Only</h1>
                        <p>Please sign in with an admin account first.</p>
                    </div>
                    <p className="auth-footer">
                        <Link className="inline-link-btn" to="/admin/login">Go to Admin Login</Link>
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="auth-shell">
            <BackToHome />
            <div className="auth-card">
                <div className="auth-card-header">
                    <h1>Create Admin</h1>
                    <p>Create additional administrator accounts</p>
                </div>
                {error && <p className="auth-error">{error}</p>}
                {success && <p className="auth-success">{success}</p>}
                <form className="auth-form" onSubmit={handleSubmit}>
                    <label className="field">
                        <span>Secret Password</span>
                        <PasswordField
                            name="bootstrap_secret"
                            value={bootstrapSecret}
                            onChange={handleSecretChange}
                            placeholder="Enter one-time setup secret"
                            required
                        />
                    </label>
                    <label className="field">
                        <span>Name</span>
                        <label className="line-input">
                            <input name="name" value={form.name} onChange={handleChange} placeholder="Admin Name" required />
                            <FiUser className="input-icon" />
                        </label>
                    </label>
                    <label className="field">
                        <span>Gmail</span>
                        <label className="line-input">
                            <input type="email" name="email" value={form.email} onChange={handleChange} placeholder="example@gmail.com" required />
                            <FiMail className="input-icon" />
                        </label>
                    </label>
                    <label className="field">
                        <span>Password</span>
                        <PasswordField name="password" value={form.password} onChange={handleChange} placeholder="Create a strong password" required />
                    </label>
                    <label className="field">
                        <span>Role</span>
                        <label className="role-select-wrap">
                            <select name="admin_scope" value={form.admin_scope} onChange={handleChange} disabled={!canCreateAdmin} required>
                                {roleOptions.map((opt) => (
                                    <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                                        {opt.label}
                                    </option>
                                ))}
                            </select>
                        </label>
                    </label>
                    <button className="primary-btn auth-submit" type="submit" disabled={loading || !canCreateAdmin}>
                        {loading ? "Creating..." : "Create Admin"}
                    </button>
                    {!canCreateAdmin && <p className="form-sub">All admin roles are already configured.</p>}
                </form>
                <p className="auth-footer">
                    Already have an account? <Link className="inline-link-btn" to="/admin/login">Sign in</Link>
                </p>
            </div>
        </div>
    );
}