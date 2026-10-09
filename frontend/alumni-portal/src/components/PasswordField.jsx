import React, { useState } from "react";
import { FaEye, FaEyeSlash } from "react-icons/fa";

export default function PasswordField({ className = "", inputClassName = "", ...props }) {
    const [showPassword, setShowPassword] = useState(false);

    return (
        <label className={`line-input password-input-wrap ${className}`.trim()}>
            <input
                {...props}
                type={showPassword ? "text" : "password"}
                className={inputClassName}
            />
            <button
                type="button"
                className="password-toggle-btn"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
            >
                {showPassword ? <FaEyeSlash className="password-toggle-icon" /> : <FaEye className="password-toggle-icon" />}
            </button>
        </label>
    );
}
