import React from "react";
import { useNavigate } from "react-router-dom";
import { FiArrowLeft } from "react-icons/fi";

/**
 * Shared "Back to Home" control for authentication pages.
 * Navigates directly to the Landing Page ("/") without relying on
 * browser history (no goBack / history navigation).
 */
export default function BackToHome({ label = "Back to Home" }) {
    const navigate = useNavigate();

    const handleClick = () => {
        navigate("/");
    };

    return (
        <button
            type="button"
            className="auth-back-btn"
            onClick={handleClick}
            aria-label="Back to Home"
        >
            <FiArrowLeft className="auth-back-icon" />
            <span className="auth-back-label">{label}</span>
        </button>
    );
}