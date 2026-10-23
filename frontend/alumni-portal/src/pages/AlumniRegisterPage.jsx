import AcademicProgramFields from "../components/AcademicProgramFields";
import React, { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../services/api";
import { FiMail, FiUser } from "react-icons/fi";
import AlumniDataPrivacyModal from "../components/AlumniDataPrivacyModal";
import PasswordField from "../components/PasswordField";
import BackToHome from "../components/BackToHome";
import AlumniDocumentInput from "../components/AlumniDocumentInput";
import { validateAlumniDocuments } from "../utils/alumniDocuments";
import RegistrationSuccessToast from "../components/RegistrationSuccessToast";
import RegistrationValidationToast from "../components/RegistrationValidationToast";
import useRegistrationValidation from "../hooks/useRegistrationValidation";
import useRegistrationOtp, { readRegistrationSession } from "../hooks/useRegistrationOtp";
import RegistrationOtpModal from "../components/RegistrationOtpModal";
import { isRegistrationGmail } from "../utils/registrationEmail";
import "./AuthPage.css";
import { getGraduationYearError, getMaxGraduationYear, isValidGraduationYear } from "../utils/graduationYear";

export default function AlumniRegisterPage() {
    const [form, setForm] = useState({
        name: "",
        email: readRegistrationSession()?.email || "",
        password: "",
        confirmPassword: "",
        role: "alumni",
        course: "",
        major: "",
        graduationYear: "",
        proofDocument: null,
        consent: false
    });
    const [loading, setLoading] = useState(false);
    const [additionalProofDocuments, setAdditionalProofDocuments] = useState([]);
    const proofDocuments = form.proofDocument ? [form.proofDocument, ...additionalProofDocuments] : [];
    const [submitted, setSubmitted] = useState(false);
    const submitting = useRef(false);
    const formRef = useRef(null);
    const emailRef = useRef(null);
    const focusEmailAfterOtpClose = useRef(false);
    const { notice, dismiss, validate } = useRegistrationValidation();
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");
    const [showPrivacyModal, setShowPrivacyModal] = useState(false);
    const [consentEnabled, setConsentEnabled] = useState(false);
    const [yearTouched, setYearTouched] = useState(false);
    const yearInvalid = !isValidGraduationYear(form.graduationYear);
    const verification = useRegistrationOtp();

    const handleChange = (e) => {
        if (e.target.name === "email" && e.target.value.trim().toLowerCase() !== form.email.trim().toLowerCase()) verification.clear();
        setForm({ ...form, [e.target.name]: e.target.value });
    };

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
        if (submitting.current || submitted || verification.busy) return;
        setYearTouched(true);
        setError("");
        if (!validate(e.currentTarget, {
            ...form,
            requiredIssue: !isRegistrationGmail(form.email)
                ? { field: "email", title: "Gmail Required", message: "Enter a valid @gmail.com address." }
                : yearInvalid ? { field: "graduationYear", title: "Invalid Academic Year", message: getGraduationYearError() } : null
        })) return;
        const documentError = validateAlumniDocuments(proofDocuments);
        if (documentError) { setError(documentError); return; }
        if (!verification.verified || verification.session?.email !== form.email.trim().toLowerCase()) {
            verification.start(form.email);
            return;
        }
        submitting.current = true;
        setLoading(true);
        setSuccess("");
        try {
            const payload = new FormData();
            payload.append("name", form.name);
            payload.append("email", form.email);
            payload.append("password", form.password);
            payload.append("role", form.role);
            payload.append("session_token", verification.session.token);
            payload.append("registration_authorization", verification.details.registration_authorization);
            payload.append("course", form.course.trim());
            payload.append("major", form.major.trim());
            payload.append("graduationYear", form.graduationYear || "");
            if (form.proofDocument) {
                payload.append("proof_document", form.proofDocument);
            }
            additionalProofDocuments.forEach(file => payload.append("proof_document", file));

            await api.post("/auth/register", payload);
            setSubmitted(true);
            setSuccess(true);
            verification.clear();
        } catch (err) {
            setError(err.message);
            if (["GMAIL_VERIFICATION_REQUIRED", "INVALID_SESSION"].includes(err.code)) verification.clear();
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
                    {verification.verified && <p className="alert alert-success" role="status">Gmail verified. Select Create Account to submit for Registrar approval.</p>}
                    {verification.restored && !submitted && <p className="small text-muted">Your Gmail verification session was restored. Re-enter your registration details and reselect your document. Passwords and files are not stored in your browser.</p>}
                    <form ref={formRef} className="auth-form" onSubmit={handleSubmit} noValidate>
                        <fieldset className="registration-fields" disabled={loading || submitted || verification.busy || verification.open}>
                            <label className="field">
                                <span>Full Name</span>
                                <label className="line-input">
                                    <input name="name" value={form.name} onChange={handleChange} placeholder="Juan Dela Cruz" required />
                                    <FiUser className="input-icon" />
                                </label>
                            </label>
                            <label className="field">
                                <span>Gmail Address</span>
                                <label className="line-input">
                                    <input ref={emailRef} type="email" name="email" value={form.email} onChange={handleChange} placeholder="juan@gmail.com" maxLength={254} required />
                                    <FiMail className="input-icon" />
                                </label>
                            </label>
                            <AcademicProgramFields course={form.course} major={form.major} onChange={academic => setForm(prev => ({ ...prev, ...academic }))} />
                            <label className="field">
                                <span>Academic Year</span>
                                <label className="line-input">
                                    <input type="text" name="graduationYear" value={form.graduationYear} onChange={handleChange} onBlur={() => setYearTouched(true)} placeholder={`1885–${getMaxGraduationYear()}`} inputMode="numeric" aria-invalid={yearTouched && yearInvalid} aria-describedby="graduation-year-error" />
                                </label>
                                {yearTouched && yearInvalid && <small id="graduation-year-error" className="text-danger" role="alert">{getGraduationYearError()}</small>}
                            </label>
                            <AlumniDocumentInput files={proofDocuments} onChange={files => {
                                setForm(prev => ({ ...prev, proofDocument: files[0] || null }));
                                setAdditionalProofDocuments(files.slice(1));
                            }} disabled={loading || submitted || verification.busy || verification.open} />
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
                                        Terms and Condition
                                    </button>{" "}
                                    I understand how my personal information will be used.
                                </span>
                            </label>
                            <button className="primary-btn auth-submit" type="submit" disabled={loading || submitted}>
                                {loading ? "Creating..." : verification.verified ? "Create Account" : "Verify Gmail & Continue"}
                            </button>
                        </fieldset>
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
            <RegistrationOtpModal verification={verification} email={form.email}
                onChangeEmail={() => { focusEmailAfterOtpClose.current = true; verification.clear(); }}
                onExited={() => {
                    if (focusEmailAfterOtpClose.current) {
                        focusEmailAfterOtpClose.current = false;
                        requestAnimationFrame(() => { emailRef.current?.focus(); emailRef.current?.select(); });
                    }
                }}
                onContinue={() => { verification.setOpen(false); requestAnimationFrame(() => formRef.current?.requestSubmit()); }} />
        </>
    );
}
