import React from "react";
import { createPortal } from "react-dom";
import { FiCheckCircle } from "react-icons/fi";
import "./RegistrationSuccessToast.css";

export default function RegistrationSuccessToast({ show, title, message, onClose }) {
    if (!show || typeof document === "undefined") return null;

    return createPortal(
        <div className="registration-toast-positioner">
            <section className="registration-success-toast" role="status" aria-live="polite" aria-atomic="true">
                <FiCheckCircle className="registration-toast-icon" aria-hidden="true" />
                <div className="registration-toast-copy">
                    <h2>{title}</h2>
                    <p>{message}</p>
                </div>
                <button type="button" className="registration-toast-close" onClick={onClose} aria-label="Close notification">
                    ×
                </button>
            </section>
        </div>,
        document.body
    );
}
