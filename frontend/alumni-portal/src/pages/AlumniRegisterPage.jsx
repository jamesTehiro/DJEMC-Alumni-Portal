import React, { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../services/api";
import { FiMail, FiUser } from "react-icons/fi";
import AlumniDataPrivacyModal from "../components/AlumniDataPrivacyModal";
import PasswordField from "../components/PasswordField";
import BackToHome from "../components/BackToHome";
import RegistrationSuccessToast from "../components/RegistrationSuccessToast";
import RegistrationValidationToast from "../components/RegistrationValidationToast";
import useRegistrationValidation from "../hooks/useRegistrationValidation";
import "./AuthPage.css";
import { getGraduationYearError, getMaxGraduationYear, isValidGraduationYear } from "../utils/graduationYear";

export default function AlumniRegisterPage() {
    const [form, setForm] = useState({
        name: "",
        email: "",
        password: "",
        confirmPassword: "",
        role: "alumni",
        course: "",
        graduationYear: "",
        proofDocument: null,
        consent: false
    });
    const [loading, setLoading] = useState(false);
    const [submitted, setSubmitted] = useState(false);
    const submitting = useRef(false);
    const { notice, dismiss, validate } = useRegistrationValidation();
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");
    const [showPrivacyModal, setShowPrivacyModal] = useState(false);
    const [consentEnabled, setConsentEnabled] = useState(false);
    const [yearTouched, setYearTouched] = useState(false);
    const yearInvalid = !isValidGraduationYear(form.graduationYear);

    const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

    const openConsentModal = (e) => {
        if (e) e.preventDefault();
        if (e) e.stopPropagation();
        setShowPrivacyModal(true);
    };

    const handlePrivacyAgree = () => {
        setConsentEnabled(true);
        setShowPrivacyModal(false);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (submitting.current || submitted) return;
        setYearTouched(true);
        setError("");
        if (!validate(e.currentTarget, {
            ...form,
            requiredIssue: yearInvalid ? { field: "graduationYear", title: "Invalid Academic Year", message: getGraduationYearError() } : null
        })) return;
        submitting.current = true;
        setLoading(true);
        setSuccess("");
        try {
            const payload = new FormData();
            payload.append("name", form.name);
            payload.append("email", form.email);
            payload.append("password", form.password);
            payload.append("role", form.role);
            payload.append("course", form.course || "");
            payload.append("graduationYear", form.graduationYear || "");
            if (form.proofDocument) {
                payload.append("proof_document", form.proofDocument);
            }

            await api.post("/auth/register", payload);
            setSubmitted(true);
            setSuccess(true);
        } catch (err) {
            setError(err.message);
        } finally {
            submitting.current = false;
            setLoading(false);
        }
    };

    return (
        <>
            <RegistrationValidationToast notice={notice} onClose={dismiss} />
            <RegistrationSuccessToast
                show={success}
                title="Account Created Successfully!"
                message="Your alumni account has been created successfully. Please wait for the verification and approval process. You will receive an update through your registered Gmail address."
                onClose={() => setSuccess(false)}
            />
            <div className="auth-shell">
                <BackToHome />
                <div className="auth-card">
                    <div className="auth-card-header">
                        <h1>Alumni Registration</h1>
                        <p>Join the DJEMC Alumni network</p>
                    </div>
                    {error && <p className="auth-error">{error}</p>}
                    <form className="auth-form" onSubmit={handleSubmit} noValidate>
                        <label className="field">
                            <span>Full Name</span>
                            <label className="line-input">
                                <input name="name" value={form.name} onChange={handleChange} placeholder="Juan Dela Cruz" required />
                                <FiUser className="input-icon" />
                            </label>
                        </label>
                        <label className="field">
                            <span>Email Address</span>
                            <label className="line-input">
                                <input type="email" name="email" value={form.email} onChange={handleChange} placeholder="juan@example.com" required />
                                <FiMail className="input-icon" />
                            </label>
                        </label>
                        <label className="field">
                            <span>Program</span>
                            <label className="line-input">
                                <input type="text" name="course" value={form.course} onChange={handleChange} placeholder="Enter program" />
                            </label>
                        </label>
                        <label className="field">
                            <span>Academic Year</span>
                            <label className="line-input">
                                <input type="text" name="graduationYear" value={form.graduationYear} onChange={handleChange} onBlur={() => setYearTouched(true)} placeholder={`1885–${getMaxGraduationYear()}`} inputMode="numeric" aria-invalid={yearTouched && yearInvalid} aria-describedby="graduation-year-error" />
                            </label>
                            {yearTouched && yearInvalid && <small id="graduation-year-error" className="text-danger" role="alert">{getGraduationYearError()}</small>}
                        </label>
                        <label className="field">
                            <span>TOR / Diploma (Proof of Graduation)</span>
                            <input
                                type="file"
                                accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp"
                                onChange={(e) => setForm((prev) => ({ ...prev, proofDocument: e.target.files?.[0] || null }))}
                            />
                        </label>
                        <label className="field">
                            <span>Password</span>
                            <PasswordField name="password" value={form.password} onChange={handleChange} placeholder="Create a strong password" required />
                        </label>
                        <label className="field" htmlFor="alumni-confirm-password">
                            <span>Confirm Password *</span>
                            <PasswordField id="alumni-confirm-password" name="confirmPassword" value={form.confirmPassword} onChange={handleChange} placeholder="Confirm your password" autoComplete="new-password" aria-label="Confirm Password" required />
                        </label>
                        <label className="consent-row">
                            <input
                                type="checkbox"
                                name="consent"
                                checked={form.consent}
                                disabled={!consentEnabled}
                                onClick={(e) => {
                                    if (!consentEnabled) {
                                        e.preventDefault();
                                        setShowPrivacyModal(true);
                                    }
                                }}
                                onChange={(e) => setForm((prev) => ({ ...prev, consent: e.target.checked }))}
                            />
                            <span>
                                I agree to the{" "}
                                <button type="button" className="inline-link-btn highlight-link" onClick={openConsentModal}>
                                    Privacy Consent
                                </button>{" "}
                                and understand how my personal information will be used.
                            </span>
                        </label>
                        <button className="primary-btn auth-submit" type="submit" disabled={loading || submitted}>
                            {loading ? "Creating..." : "Create Account"}
                        </button>
                    </form>
                    <p className="auth-footer">
                        Already have an account? <Link className="inline-link-btn" to="/login">Sign in</Link>
                    </p>
                </div>
            </div>
            <AlumniDataPrivacyModal
                show={showPrivacyModal}
                onHide={() => setShowPrivacyModal(false)}
                onAgree={handlePrivacyAgree}
            />
        </>
    );
}
