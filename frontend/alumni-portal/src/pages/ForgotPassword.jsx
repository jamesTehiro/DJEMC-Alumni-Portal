import React, { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../services/api";
import BackToHome from "../components/BackToHome";
import "./AuthPage.css";

const ALLOWED_ROLES = ["alumni", "employer"];

/** Maps a role query parameter to the correct login route path. */
function getLoginPath(role) {
    switch (role) {
        case "admin":
            return "/login/admin";
        case "employer":
            return "/login/employer";
        case "alumni":
        default:
            return "/login/alumni";
    }
}

export default function ForgotPassword() {
    const [searchParams] = useSearchParams();
    const roleParam = String(searchParams.get("role") || "").toLowerCase();
    const initialRole = ALLOWED_ROLES.includes(roleParam) ? roleParam : "alumni";

    // Preserve the original role from the URL for navigation purposes.
    // The `role` state is filtered to ALLOWED_ROLES for the API call,
    // while `originRole` keeps the raw value (e.g. "admin") for "Back to Sign In".
    const originRole = roleParam || "alumni";

    const [email, setEmail] = useState("");
    const [role, setRole] = useState(initialRole);
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState("");
    const [error, setError] = useState("");

    const showRoleSelect = !ALLOWED_ROLES.includes(roleParam);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError("");
        setMessage("");

        try {
            await api.post("/auth/forgot-password", {
                email,
                role
            });
            setMessage("If an account exists, a reset link has been sent.");
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
                    <img src="/logo.png" alt="DJEMC" className="auth-logo" />
                    <h1>Forgot Password</h1>
                    <p>Enter your email and we will send a reset link if the account exists.</p>
                </div>
                {message && <p className="auth-success">{message}</p>}
                {error && <p className="auth-error">{error}</p>}
                <form className="auth-form" onSubmit={handleSubmit}>
                    <label className="field">
                        <span>Email Address</span>
                        <label className="line-input">
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="Enter your email"
                                required
                            />
                        </label>
                    </label>

                    <label className="field">
                        <span>Account Type</span>
                        {showRoleSelect ? (
                            <label className="role-select-wrap">
                                <select value={role} onChange={(e) => setRole(e.target.value)} required>
                                    <option value="alumni">Admin Alumni</option>
                                    <option value="employer">Admin Employer</option>
                                    <option value="registrar">Admin Registrar</option>
                                </select>
                            </label>
                        ) : (
                            <input type="hidden" value={role} readOnly />
                        )}
                    </label>

                    <button className="primary-btn auth-submit" type="submit" disabled={loading}>
                        {loading ? "Sending..." : "Send Reset Link"}
                    </button>
                </form>
                <p className="auth-footer">
                    <Link className="inline-link-btn" to={getLoginPath(originRole)}>
                        Back to Sign In
                    </Link>
                </p>
            </div>
        </div>
    );
}
