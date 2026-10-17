import React, { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../services/api";
import { FiGlobe, FiMail, FiShield, FiUser } from "react-icons/fi";
import PasswordField from "../components/PasswordField";
import BackToHome from "../components/BackToHome";
import BusinessPermitInput from "../components/BusinessPermitInput";
import { validateBusinessPermits } from "../utils/businessPermits";
import "./RegisterPage.css";

export default function RegisterEmployerPage() {
    const navigate = useNavigate();
    const [form, setForm] = useState({
        name: "",
        email: "",
        companyAddress: "",
        websiteUrl: "",
        password: "",
        consent: false
    });
    const [businessPermits, setBusinessPermits] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");
    const [showConsentModal, setShowConsentModal] = useState(false);
    const [consentEnabled, setConsentEnabled] = useState(false);
    const [consentRead, setConsentRead] = useState(false);
    const requiredMark = useMemo(() => <span className="required-mark"> *</span>, []);

    const handleChange = (e) => {
        setForm({ ...form, [e.target.name]: e.target.value });
    };

    const handleRegister = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError("");
        setSuccess("");

        try {
            if (!form.consent) {
                setError("Please agree to the Data Privacy Consent.");
                setLoading(false);
                return;
            }

            const permitError = validateBusinessPermits(businessPermits);
            if (permitError) {
                setError(permitError);
                setLoading(false);
                return;
            }

            // ADD THIS
            const payload = new FormData();
            payload.append("name", form.name);
            payload.append("email", form.email);
            payload.append("password", form.password);
            payload.append("role", "employer");
            payload.append("company_address", form.companyAddress);
            payload.append("website_url", form.websiteUrl);
            businessPermits.forEach(file => payload.append("business_permit", file));

            await api.post("/auth/register", payload);
            setSuccess("Employer registration submitted. You can now log in.");
            setTimeout(() => navigate("/login?role=employer"), 700);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handlePolicyScroll = (e) => {
        const { scrollTop, clientHeight, scrollHeight } = e.target;
        if (scrollTop + clientHeight >= scrollHeight - 5) {
            setConsentEnabled(true);
        }
    };

    const handleAgree = () => {
        setShowConsentModal(false);
        setConsentRead(true);
        setForm((prev) => ({ ...prev, consent: true }));
    };

    const handleConsentModalClose = () => {
        setShowConsentModal(false);
        if (consentEnabled) setConsentRead(true);
    };

    const openConsentModal = (e) => {
        if (e) e.stopPropagation();
        setConsentEnabled(false);
        setForm((prev) => ({ ...prev, consent: false }));
        setShowConsentModal(true);
    };

    return (
        <>
            <div className="auth-shell">
                <BackToHome />
                <div className="split-auth single">
                    <div className="form-side sign-up-side">
                        <form className="auth-form" onSubmit={handleRegister}>
                            <h2>Employer Registration</h2>
                            <p className="form-sub">Register your organization for the employer portal.</p>
                            <p className="form-sub employer-trust-note"><FiShield /> Only verified employers can post jobs.</p>
                            {error && <p className="auth-error">{error}</p>}
                            {success && <p className="auth-success">{success}</p>}

                            <div className="auth-form-grid row gx-0 gy-3">
                                <div className="col-12">
                                    <p className="field-label">Company Name{requiredMark}</p>
                                    <label className="line-input">
                                        <input
                                            name="name"
                                            value={form.name}
                                            onChange={handleChange}
                                            placeholder="DJEMC Organization"
                                            required
                                        />
                                        <FiUser className="input-icon" />
                                    </label>
                                </div>

                                <div className="col-12">
                                    <p className="field-label">Gmail{requiredMark}</p>
                                    <label className="line-input">
                                        <input
                                            type="email"
                                            name="email"
                                            value={form.email}
                                            onChange={handleChange}
                                            placeholder="organization@gmail.com"
                                            required
                                        />
                                        <FiMail className="input-icon" />
                                    </label>
                                </div>

                                <div className="col-12">
                                    <p className="field-label">Company Address{requiredMark}</p>
                                    <label className="line-input">
                                        <input
                                            name="companyAddress"
                                            value={form.companyAddress}
                                            onChange={handleChange}
                                            placeholder="Municipality of San Jose"
                                            required
                                        />
                                        <FiUser className="input-icon" />
                                    </label>
                                </div>

                                <div className="col-12">
                                    <p className="field-label">Company Website or Facebook Page</p>
                                    <label className="line-input">
                                        <input
                                            name="websiteUrl"
                                            value={form.websiteUrl}
                                            onChange={handleChange}
                                            placeholder="https://company-site.com or Facebook page"
                                        />
                                        <FiGlobe className="input-icon" />
                                    </label>
                                </div>

                                <div className="col-12">
                                    <p className="field-label">Password{requiredMark}</p>
                                    <PasswordField
                                        name="password"
                                        value={form.password}
                                        onChange={handleChange}
                                        placeholder="Create a strong password"
                                        required
                                    />
                                </div>

                                <div className="col-12">
                                    <BusinessPermitInput files={businessPermits} onChange={setBusinessPermits} disabled={loading} />
                                </div>
                            </div>

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
                                    <span
                                        role="button"
                                        tabIndex={0}
                                        className="inline-link-btn highlight-link"
                                        onClick={openConsentModal}
                                        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && openConsentModal(e)}
                                    >
                                        Data Privacy Consent
                                    </span>{" "}
                                    and understand how company information and uploaded documents will be used.
                                </span>
                            </label>

                            <button className="pill-btn" type="submit" disabled={loading}>
                                {loading ? "Creating..." : "Create Employer Account"}
                            </button>

                            <p className="signin-line">
                                Already have an account? <Link className="inline-link-btn" to="/login?role=employer">Sign in</Link>
                            </p>
                        </form>
                    </div>
                </div>
            </div>

            {showConsentModal && (
                <div className="consent-backdrop" onClick={handleConsentModalClose}>
                    <div
                        className="consent-modal"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="consent-header">
                            <h4>Employer Data Privacy Consent</h4>
                            <button type="button" className="inline-link-btn" onClick={handleConsentModalClose}>
                                Close
                            </button>
                        </div>
                        <div className="consent-body" onScroll={handlePolicyScroll}>
                            <p>We collect company and business contact information to create and review employer accounts on the platform.</p>
                            <p>Submitted company names, email addresses, office addresses, and optional website or Facebook links are used for account setup, verification, and recruitment-related contact.</p>
                            <p>Uploaded business permits or registration files such as BIR, DTI, or SEC documents are handled for business verification and admin review only.</p>
                            <p>Information collected may be used to:</p>
                            <ul>
                                <li>Confirm the legitimacy of the business before account activation.</li>
                                <li>Allow verified employers to post jobs and communicate with alumni applicants.</li>
                                <li>Support document handling and employer approval decisions by authorized admins.</li>
                                <li>Use employer contact information for recruitment coordination and portal notices.</li>
                            </ul>
                            <p>Employer verification documents are retained only as needed for review, compliance, security, and legitimate recordkeeping.</p>
                            <p>By consenting, you acknowledge and accept this employer-specific handling of business information, permit files, and recruitment contact usage.</p>
                            <p>End of employer privacy policy. Close this modal after reading to enable the consent checkbox.</p>
                        </div>
                        <div className="consent-footer">
                            <p className="scroll-hint">{consentEnabled ? "You can now close this modal and check the consent box." : "Please read the entire privacy policy to enable the Agree button."}</p>
                            <div className="consent-actions">
                                <button type="button" className="inline-link-btn" onClick={handleConsentModalClose}>Cancel</button>
                                <button type="button" className="primary-btn" disabled={!consentEnabled} onClick={handleAgree}>I Understand & Agree</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
