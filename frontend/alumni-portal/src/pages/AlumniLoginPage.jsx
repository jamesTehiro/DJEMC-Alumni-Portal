import React, { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../services/api";
import { FiMail } from "react-icons/fi";
import PasswordField from "../components/PasswordField";
import BackToHome from "../components/BackToHome";
import LoginButton from "../components/ui/LoginButton";
import "./AuthPage.css";

export default function AlumniLoginPage() {
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
            localStorage.setItem("token", data.token);
            localStorage.setItem("user", JSON.stringify(data.user));
            if (data.user?.role === "admin") {
                if (data.user?.admin_scope === "employer") window.location.href = "/admin/employer";
                else if (data.user?.admin_scope === "registrar") window.location.href = "/admin/registrar";
                else window.location.href = "/admin/alumni";
            } else if (data.user?.role === "employer") window.location.href = "/employer";
            else window.location.href = "/dashboard";
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
                    <h1>Alumni Login</h1>
                    <p>Sign in to your alumni account</p>
                </div>
                {error && <p className="auth-error">{error}</p>}
                <form className="auth-form" onSubmit={handleSubmit}>
                    <label className="field">
                        <span>Email Address</span>
                        <label className="line-input">
                            <input type="email" name="email" value={form.email} onChange={handleChange} placeholder="juan@example.com" required />
                            <FiMail className="input-icon" />
                        </label>
                    </label>
                    <label className="field">
                        <span>Password</span>
                        <PasswordField name="password" value={form.password} onChange={handleChange} placeholder="Password" required />
                    </label>
                    <div className="auth-form-actions">
                        <Link className="inline-link-btn" to="/forgot-password?role=alumni">Forgot Password?</Link>
                    </div>
                    <LoginButton loading={loading} />
                </form>
                <p className="auth-footer">
                    Don't have an account? <Link className="inline-link-btn" to="/register">Register</Link>
                </p>
            </div>
        </div>
    );
}