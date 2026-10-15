import React from "react";
import { createPortal } from "react-dom";
import { FiAlertCircle, FiCheckCircle } from "react-icons/fi";
import "./RegistrationSuccessToast.css";

export function RegistrationToastContent({ title, message, onClose, variant = "success" }) {
    const isError = variant === "error";
    const Icon = isError ? FiAlertCircle : FiCheckCircle;

    return (
        <section
            className={`registration-success-toast${isError ? " registration-success-toast--error" : ""}`}
            role={isError ? "alert" : "status"}
            aria-live={isError ? "assertive" : "polite"}
            aria-atomic="true"
        >
            <Icon className="registration-toast-icon" aria-hidden="true" />
            <div className="registration-toast-copy">
                <h2>{title}</h2>
                <p>{message}</p>
            </div>
            <button type="button" className="registration-toast-close" onClick={onClose} aria-label="Close notification">
                ×
            </button>
        </section>
    );
}

export default function RegistrationSuccessToast({ show, title, message, onClose, variant = "success", positionerClassName = "" }) {
    if (!show || typeof document === "undefined") return null;

    return createPortal(
        <div className={`registration-toast-positioner${positionerClassName ? ` ${positionerClassName}` : ""}`}>
            <RegistrationToastContent title={title} message={message} onClose={onClose} variant={variant} />
        </div>,
        document.body
    );
}
