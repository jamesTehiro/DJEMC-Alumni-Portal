import React, { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../services/api";
import { FiMail } from "react-icons/fi";
import PasswordField from "../components/PasswordField";
import BackToHome from "../components/BackToHome";
import LoginButton from "../components/ui/LoginButton";
import "./AuthPage.css";

export default function AdminLoginPage() {
    const [form, setForm] = useState({ email: "", password: "" });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError("");
        try {
            const data = await api.post("/auth/login", form);
            if (data.user?.role !== "admin") throw new Error("This portal is for admin accounts only.");
            localStorage.setItem("token", data.token);
            localStorage.setItem("user", JSON.stringify(data.user));
            if (data.user.admin_scope === "employer") window.location.href = "/admin/employer";
            else if (data.user.admin_scope === "registrar") window.location.href = "/admin/registrar";
            else window.location.href = "/admin/alumni";
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="auth-shell">
            <BackToHome />
            <div className="auth-card">
                <div className="auth-card-header">
                    <h1>Admin Login</h1>
                    <p>Sign in with your admin credentials</p>
                </div>
                {error && <p className="auth-error">{error}</p>}
                <form className="auth-form" onSubmit={handleSubmit}>
                    <label className="field">
                        <span>Email Address</span>
                        <label className="line-input">
                            <input type="email" name="email" value={form.email} onChange={handleChange} placeholder="admin@example.com" required />
                            <FiMail className="input-icon" />
                        </label>
                    </label>
                    <label className="field">
                        <span>Password</span>
                        <PasswordField name="password" value={form.password} onChange={handleChange} placeholder="Password" required />
                    </label>
                    <div className="auth-form-actions">
                        <Link className="inline-link-btn" to="/forgot-password?role=admin">Forgot Password?</Link>
                    </div>
                    <LoginButton loading={loading} />
                </form>
                <p className="auth-footer">
                    New admin? <Link className="inline-link-btn" to="/admin/create">Create account</Link>
                </p>
            </div>
        </div>
    );
}