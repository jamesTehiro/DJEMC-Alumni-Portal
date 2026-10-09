import React, { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../services/api";
import PasswordField from "../components/PasswordField";
import BackToHome from "../components/BackToHome";
import "./AuthPage.css";

export default function ResetPassword() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const token = String(searchParams.get("token") || "");

    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState("");
    const [error, setError] = useState("");

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError("");
        setMessage("");

        if (!token) {
            setError("Reset link is missing a token.");
            return;
        }

        if (newPassword !== confirmPassword) {
            setError("Passwords do not match.");
            return;
        }

        setLoading(true);
        try {
            const data = await api.post("/auth/reset-password", {
                token,
                newPassword
            });
            setMessage(data?.msg || "Password updated successfully.");
            setTimeout(() => navigate(`/login${data?.role ? `?role=${data.role}` : ""}`), 900);
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
                    <h1>Reset Password</h1>
                    <p>Create a new password for your account.</p>
                </div>
                {message && <p className="auth-success">{message}</p>}
                {error && <p className="auth-error">{error}</p>}
                <form className="auth-form" onSubmit={handleSubmit}>
                    <label className="field">
                        <span>New Password</span>
                        <PasswordField
                            name="newPassword"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            placeholder="Enter new password"
                            required
                        />
                    </label>

                    <label className="field">
                        <span>Confirm Password</span>
                        <PasswordField
                            name="confirmPassword"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            placeholder="Confirm new password"
                            required
                        />
                    </label>

                    <button className="primary-btn auth-submit" type="submit" disabled={loading || !token}>
                        {loading ? "Updating..." : "Update Password"}
                    </button>
                </form>
                <p className="auth-footer">
                    <Link className="inline-link-btn" to="/login/alumni">
                        Back to Sign In
                    </Link>
                </p>
            </div>
        </div>
    );
}