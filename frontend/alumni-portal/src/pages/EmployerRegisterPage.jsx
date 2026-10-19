import React, { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../services/api";
import { FiGlobe, FiMail, FiUser } from "react-icons/fi";
import PasswordField from "../components/PasswordField";
import BackToHome from "../components/BackToHome";
import RegistrationSuccessToast from "../components/RegistrationSuccessToast";
import RegistrationValidationToast from "../components/RegistrationValidationToast";
import useRegistrationValidation from "../hooks/useRegistrationValidation";
import BusinessPermitInput from "../components/BusinessPermitInput";
import { validateBusinessPermits } from "../utils/businessPermits";
import "./AuthPage.css";

export default function EmployerRegisterPage() {
    const [form, setForm] = useState({
        name: "",
        email: "",
        companyAddress: "",
        websiteUrl: "",
        password: "",
        confirmPassword: "",
        consent: false
    });
    const [businessPermits, setBusinessPermits] = useState([]);
    const [loading, setLoading] = useState(false);
    const [submitted, setSubmitted] = useState(false);
    const submitting = useRef(false);
    const { notice, dismiss, validate } = useRegistrationValidation();
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");
    const [showConsentModal, setShowConsentModal] = useState(false);
    const [consentEnabled, setConsentEnabled] = useState(false);
    const [consentRead, setConsentRead] = useState(false);
    const requiredMark = useMemo(() => <span className="required-mark"> *</span>, []);

    const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (submitting.current || submitted) return;
        setError("");
        const permitError = validateBusinessPermits(businessPermits);
        if (!validate(e.currentTarget, {
            ...form, employer: true,
            requiredIssue: permitError ? { field: "document", title: "Business Permit Required", message: permitError } : null
        })) return;
        submitting.current = true;
        setLoading(true);
        setSuccess("");
        try {
            const payload = new FormData();
            payload.append("name", form.name);
            payload.append("email", form.email);
            payload.append("password", form.password);
            payload.append("role", "employer");
            payload.append("company_address", form.companyAddress);
            payload.append("website_url", form.websiteUrl);
            businessPermits.forEach(file => payload.append("business_permit", file));
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

    const handlePolicyScroll = (e) => {
        const { scrollTop, clientHeight, scrollHeight } = e.target;
        if (scrollTop + clientHeight >= scrollHeight - 5) setConsentEnabled(true);
    };

    const handleConsentModalClose = () => {
        setShowConsentModal(false);
    };

    const handleAgree = () => {
        setShowConsentModal(false);
        setConsentRead(true);
    };

    const openConsentModal = (e) => {
        if (e) e.preventDefault();
        if (e) e.stopPropagation();
        setConsentEnabled(false);
        setForm((prev) => ({ ...prev, consent: false }));
        setShowConsentModal(true);
    };

    return (
        <>
            <RegistrationValidationToast notice={notice} onClose={dismiss} />
            <RegistrationSuccessToast
                show={success}
                title="Registration Submitted Successfully!"
                message="Your employer account has been created successfully. Please wait for admin verification and approval. You will receive an update through your registered Gmail address."
                onClose={() => setSuccess(false)}
            />
            <div className="auth-shell">
                <BackToHome />
                <div className="auth-card">
                    <div className="auth-card-header">
                        <h1>Employer Registration</h1>
                        <p>Register your organization for the employer portal.</p>
                    </div>
                    {error && <p className="auth-error">{error}</p>}
                    <form className="auth-form" onSubmit={handleSubmit} noValidate>
                        <label className="field">
                            <span>Company Name{requiredMark}</span>
                            <label className="line-input">
                                <input name="name" value={form.name} onChange={handleChange} placeholder="DJEMC Organization" required />
                                <FiUser className="input-icon" />
                            </label>
                        </label>
                        <label className="field">
                            <span>Gmail{requiredMark}</span>
                            <label className="line-input">
                                <input type="email" name="email" value={form.email} onChange={handleChange} placeholder="organization@gmail.com" required />
                                <FiMail className="input-icon" />
                            </label>
                        </label>
                        <label className="field">
                            <span>Company Address{requiredMark}</span>
                            <label className="line-input">
                                <input name="companyAddress" value={form.companyAddress} onChange={handleChange} placeholder="Municipality of San Jose" required />
                                <FiUser className="input-icon" />
                            </label>
                        </label>
                        <label className="field">
                            <span>Company Website or Facebook Page</span>
                            <label className="line-input">
                                <input name="websiteUrl" value={form.websiteUrl} onChange={handleChange} placeholder="https://company-site.com or Facebook page" />
                                <FiGlobe className="input-icon" />
                            </label>
                        </label>
                        <label className="field">
                            <span>Password{requiredMark}</span>
                            <PasswordField name="password" value={form.password} onChange={handleChange} placeholder="Create a strong password" required />
                        </label>
                        <label className="field" htmlFor="employer-confirm-password">
                            <span>Confirm Password *</span>
                            <PasswordField id="employer-confirm-password" name="confirmPassword" value={form.confirmPassword} onChange={handleChange} placeholder="Confirm your password" autoComplete="new-password" aria-label="Confirm Password" required />
                        </label>
                        <BusinessPermitInput files={businessPermits} onChange={setBusinessPermits} disabled={loading} />
                        <label className="consent-row">
                            <input
                                type="checkbox"
                                name="consent"
                                disabled={!consentRead}
                                checked={form.consent}
                                onChange={(e) => setForm((prev) => ({ ...prev, consent: e.target.checked }))}
                            />
                            <span>
                                I agree to the{" "}
                                <span role="button" tabIndex={0} className="inline-link-btn highlight-link" onClick={openConsentModal} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && openConsentModal(e)}>
                                    Terms and Conditions
                                </span>{" "}
                                and understand how company information and uploaded documents will be used.
                            </span>
                        </label>
                        <button className="primary-btn auth-submit" type="submit" disabled={loading || submitted}>
                            {loading ? "Creating..." : "Create Employer Account"}
                        </button>
                    </form>
                    <p className="auth-footer">
                        Already have an account? <Link className="inline-link-btn" to="/login/employer">Sign in</Link>
                    </p>
                </div>
                {showConsentModal && (
                    <div className="consent-backdrop" onClick={handleConsentModalClose}>
                        <div className="consent-modal" onClick={(e) => e.stopPropagation()}>
                            <div className="consent-header">
                                <h4>Employer Data Privacy Consent</h4>
                                <button type="button" className="inline-link-btn" onClick={handleConsentModalClose}>
                                    Close
                                </button>
                            </div>
                            <div className="consent-body" onScroll={handlePolicyScroll}>
                                <p><strong>Data Retention</strong></p>
                                <p>
                                    All employer information and uploaded verification documents are retained only
                                    for as long as necessary to fulfill verification, legal, security, and
                                    administrative purposes. Records may be archived or securely deleted in
                                    accordance with applicable laws and institutional policies.
                                </p>

                                <p><strong>Data Security</strong></p>
                                <p>
                                    The DJEMC Alumni Tracking and Job Portal System implements appropriate
                                    administrative, technical, and physical safeguards to protect employer
                                    information from unauthorized access, disclosure, alteration, or destruction.
                                    Access to verification documents is restricted to authorized administrators
                                    responsible for employer approval.
                                </p>

                                <p><strong>Information Sharing</strong></p>
                                <p>
                                    Employer information will not be sold or disclosed to third parties except when
                                    required by law, court order, or government regulation, or when necessary for
                                    the operation, maintenance, and security of the system.
                                </p>

                                <p><strong>Employer Responsibilities</strong></p>
                                <p>
                                    Employers are responsible for ensuring that all information submitted during
                                    registration is complete, accurate, and up to date. Submission of false or
                                    misleading information may result in account rejection, suspension, or
                                    termination.
                                </p>

                                <p><strong>Account Verification</strong></p>
                                <p>
                                    All employer accounts undergo an administrative verification process before
                                    being granted access to post job opportunities. Verification documents are
                                    reviewed solely for confirming the legitimacy of the organization.
                                </p>

                                <p><strong>Use of Recruitment Information</strong></p>
                                <p>
                                    Verified employers may use the system only for legitimate recruitment,
                                    employment, internship, and career opportunity postings intended for DJEMC
                                    graduates and alumni.
                                </p>

                                <p><strong>Employer Rights</strong></p>
                                <p>
                                    Employers may request to review, update, or correct their submitted
                                    registration information. Requests may be submitted through the system
                                    administrator or designated data protection contact.
                                </p>

                                <p><strong>Data Privacy Compliance</strong></p>
                                <p>
                                    The collection and processing of employer information are conducted in
                                    accordance with the Data Privacy Act of 2012 (Republic Act No. 10173) and other
                                    applicable Philippine laws governing data protection and privacy.
                                </p>

                                <p><strong>System Logs</strong></p>
                                <p>
                                    For security and auditing purposes, the system may record login attempts,
                                    verification activities, account updates, job posting activities, and other
                                    relevant system events to help detect unauthorized access and maintain system
                                    integrity.
                                </p>

                                <p><strong>Consent Withdrawal</strong></p>
                                <p>
                                    An employer may request withdrawal of consent by contacting the system
                                    administrator. Withdrawal of consent may affect the ability to continue using
                                    certain features of the DJEMC Alumni Tracking and Job Portal System.
                                </p>

                                <p><strong>Contact Information</strong></p>
                                <p>
                                    Questions regarding the collection, use, or protection of employer information
                                    may be directed to the DJEMC Alumni Tracking and Job Portal System
                                    Administrator through the official institutional communication channels.
                                </p>

                                <p><strong>Acknowledgment</strong></p>
                                <p>
                                    By clicking <strong>"I Understand & Agree"</strong>, you acknowledge that you
                                    have read and understood this Employer Data Privacy Consent and voluntarily
                                    consent to the collection, processing, storage, and use of your submitted
                                    business information for the purposes described above.
                                </p>
                            </div>
                            <div className="consent-footer">
                                <p className="scroll-hint">{consentEnabled ? "You can now close this modal and check the consent box." : "Please read the entire privacy policy to enable the Agree button."}</p>
                                <div className="consent-actions">
                                    <button type="button" className="inline-link-btn" onClick={handleConsentModalClose}>
                                        Cancel
                                    </button>
                                    <button
                                        type="button"
                                        className="primary-btn"
                                        disabled={!consentEnabled}
                                        onClick={handleAgree}
                                    >
                                        I Understand & Agree
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </>
    );
}
