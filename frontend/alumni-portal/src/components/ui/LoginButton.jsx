import React from "react";
import "./LoginButton.css";

/**
 * Reusable Login Button Component
 * Used across Alumni, Employer, and Admin login pages
 */
export default function LoginButton({ loading = false, disabled = false, onClick, type = "submit" }) {
    return (
        <button
            className="login-button"
            type={type}
            disabled={disabled || loading}
            onClick={onClick}
        >
            {loading ? "Signing In..." : "Login"}
        </button>
    );
}