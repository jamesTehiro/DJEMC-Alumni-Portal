import AcademicProgramFields from "../components/AcademicProgramFields";
import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../services/api";
import { FiMail, FiUser } from "react-icons/fi";
import AlumniDataPrivacyModal from "../components/AlumniDataPrivacyModal";
import PasswordField from "../components/PasswordField";
import BackToHome from "../components/BackToHome";
import "./RegisterPage.css";

export default function RegisterPage() {
    const navigate = useNavigate();
    const [isRightPanelActive, setIsRightPanelActive] = useState(true);
    const [registerForm, setRegisterForm] = useState({
        name: "",
        email: "",
        password: "",
        role: "alumni",
        course: "",
        major: "",
        graduationYear: "",
        consent: false
    });
    const [loginForm, setLoginForm] = useState({
        email: "",
        password: ""
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");
    const [showPrivacyModal, setShowPrivacyModal] = useState(false);
    const [consentEnabled, setConsentEnabled] = useState(false);

    const handleRegisterChange = (e) => {
        setRegisterForm({ ...registerForm, [e.target.name]: e.target.value });
    };

    const openConsentModal = (e) => {
        if (e) e.stopPropagation();
        setShowPrivacyModal(true);
    };

    const handlePrivacyAgree = () => {
        setConsentEnabled(true);
        setRegisterForm((prev) => ({ ...prev, consent: true }));
        setShowPrivacyModal(false);
    };

    const handleRoleChange = (e) => {
        const nextRole = e.target.value;
        if (nextRole === "employer") {
            navigate("/register/employer");
            return;
        }
        setRegisterForm((prev) => ({ ...prev, role: nextRole }));
    };

    const handleLoginChange = (e) => {
        setLoginForm({ ...loginForm, [e.target.name]: e.target.value });
    };

    const handleRegister = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError("");
        setSuccess("");

        try {
            if (!registerForm.consent) {
                setError("Please agree to the Data Privacy Consent.");
                setLoading(false);
                return;
            }

            await api.post("/auth/register", {
                name: registerForm.name,
                email: registerForm.email,
                password: registerForm.password,
                role: registerForm.role,
                course: registerForm.course.trim(),
                major: registerForm.major.trim(),
                graduationYear: registerForm.graduationYear
            });
            setSuccess("Registration successful. You can now log in.");
            setTimeout(() => setIsRightPanelActive(false), 500);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleLogin = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError("");
        setSuccess("");

        try {
            const data = await api.post("/auth/login", loginForm);
            localStorage.setItem("token", data.token);
            localStorage.setItem("user", JSON.stringify(data.user));

            if (data.user?.role === "admin") navigate("/admin");
            else if (data.user?.role === "employer") navigate("/employer");
            else navigate("/dashboard");
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
            <div className="auth-shell">
                <BackToHome />
                <div className={`split-auth ${isRightPanelActive ? "active" : ""}`}>
                    <div className="form-side sign-up-side">
                        <form className="auth-form" onSubmit={handleRegister}>
                            <h2>Create Your Account</h2>
                            <p className="form-sub">Join the DJEMC Alumni network today</p>
                            {error && <p className="auth-error">{error}</p>}
                            {success && <p className="auth-success">{success}</p>}

                            <div className="auth-form-grid row gx-0 gy-3">
                                <div className="col-12">
                                    <p className="field-label">Full Name</p>
                                    <label className="line-input">
                                        <input
                                            name="name"
                                            value={registerForm.name}
                                            onChange={handleRegisterChange}
                                            placeholder="Juan Dela Cruz"
                                            required
                                        />
                                        <FiUser className="input-icon" />
                                    </label>
                                </div>

                                <div className="col-12">
                                    <p className="field-label">Email Address</p>
                                    <label className="line-input">
                                        <input
                                            type="email"
                                            name="email"
                                            value={registerForm.email}
                                            onChange={handleRegisterChange}
                                            placeholder="juan@example.com"
                                            required
                                        />
                                        <FiMail className="input-icon" />
                                    </label>
                                </div>

                                <div className="col-12 col-sm-12 col-md-6 col-lg-6">
                                    <p className="field-label">Register As</p>
                                    <label className="role-select-wrap">
                                        <select name="role" value={registerForm.role} onChange={handleRoleChange}>
                                            <option value="alumni">Alumni</option>
                                        </select>
                                    </label>
                                </div>

                                <div className="col-12 col-sm-12 col-md-6 col-lg-6">
                                    <label htmlFor="graduationYear" className="field-label">
                                        Academic Year
                                    </label>

                                    <label className="line-input">
                                        <input
                                            id="graduationYear"
                                            type="text"
                                            name="graduationYear"
                                            value={registerForm.graduationYear ?? ""}
                                            onChange={handleRegisterChange}
                                            placeholder="Enter Academic Year"
                                            inputMode="numeric"
                                            maxLength={4}
                                            pattern="[0-9]{4}"
                                            title="Enter a four-digit year."
                                        />
                                    </label>
                                </div>

                                <div className="col-12">
                                    <AcademicProgramFields course={registerForm.course} major={registerForm.major} onChange={academic => setRegisterForm(prev => ({ ...prev, ...academic }))} />
                                </div>

                                <div className="col-12">
                                    <p className="field-label">Password</p>
                                    <PasswordField
                                        name="password"
                                        value={registerForm.password}
                                        onChange={handleRegisterChange}
                                        placeholder="Create a strong password"
                                        required
                                    />
                                </div>
                            </div>

                            <label className="consent-row">
                                <input
                                    type="checkbox"
                                    name="consent"
                                    checked={registerForm.consent}
                                    disabled={!consentEnabled}
                                    onClick={(e) => {
                                        if (!consentEnabled) {
                                            e.preventDefault();
                                            setShowPrivacyModal(true);
                                        }
                                    }}
                                    onChange={(e) =>
                                        setRegisterForm((prev) => ({ ...prev, consent: e.target.checked }))
                                    }
                                />
                                <span>
                                    I agree to the{" "}
                                    <button
                                        type="button"
                                        className="inline-link-btn highlight-link"
                                        onClick={openConsentModal}
                                    >
                                        Terms and Condition
                                    </button>{" "}
                                    and understand how my personal information will be used.
                                </span>
                            </label>

                            <button className="pill-btn" type="submit" disabled={loading}>
                                {loading ? "Creating..." : "Create Account"}
                            </button>

                            <p className="signin-line">
                                Already have an account?{" "}
                                <button
                                    type="button"
                                    className="inline-link-btn"
                                    onClick={() => setIsRightPanelActive(false)}
                                >
                                    Sign in here
                                </button>
                            </p>

                        </form>
                    </div>

                    <div className="form-side sign-in-side">
                        <form className="auth-form" onSubmit={handleLogin}>
                            <h2>Welcome Back</h2>
                            <p className="form-sub">Use your account credentials</p>
                            {error && <p className="auth-error">{error}</p>}

                            <div className="auth-form-grid row gx-0 gy-3">
                                <div className="col-12">
                                    <label className="line-input">
                                        <input
                                            type="email"
                                            name="email"
                                            value={loginForm.email}
                                            onChange={handleLoginChange}
                                            placeholder="Email"
                                            required
                                        />
                                        <FiMail className="input-icon" />
                                    </label>
                                </div>

                                <div className="col-12">
                                    <PasswordField
                                        name="password"
                                        value={loginForm.password}
                                        onChange={handleLoginChange}
                                        placeholder="Password"
                                        required
                                    />
                                </div>
                            </div>

                            <div className="signin-line" style={{ marginTop: "-4px", marginBottom: "14px" }}>
                                <Link className="inline-link-btn" to="/forgot-password?role=alumni">
                                    Forgot Password?
                                </Link>
                            </div>

                            <button className="pill-btn" type="submit" disabled={loading}>
                                {loading ? "Signing In..." : "Sign In"}
                            </button>
                        </form>
                    </div>

                    <div className="diagonal-overlay">
                        <div className="overlay-panel overlay-left">
                            <h3>Already Registered?</h3>
                            <p>Log in and continue where you left off.</p>
                            <button type="button" className="ghost-btn" onClick={() => setIsRightPanelActive(false)}>
                                Sign In
                            </button>
                        </div>

                        <div className="overlay-panel overlay-right">
                            <h3>New Here?</h3>
                            <p>Create your account and connect with the DJEMC network.</p>
                            <button type="button" className="ghost-btn" onClick={() => setIsRightPanelActive(true)}>
                                Sign Up
                            </button>
                        </div>
                    </div>
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