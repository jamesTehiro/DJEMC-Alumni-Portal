import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../../services/api";
import PasswordField from "../../../components/ui/PasswordField";
import BackToHome from "../../../components/ui/BackToHome";
import LoginButton from "../../../components/ui/LoginButton";
import useRegistrationOtp from "../../registration/hooks/useRegistrationOtp";
import RegistrationOtpModal from "../../registration/components/RegistrationOtpModal";
import RegistrationSuccessToast from "../../registration/components/RegistrationSuccessToast";
import RegistrationValidationToast from "../../registration/components/RegistrationValidationToast";
import useRegistrationValidation from "../../registration/hooks/useRegistrationValidation";
import { isRegistrationGmail } from "../../../utils/registrationEmail";
import { registrationNotice } from "../utils/adminSetupStatus";
import "../../../styles/AuthPage.css";

const ROLES = [{ value: "registrar", label: "Registrar Officer" }, { value: "alumni", label: "Alumni Coordinator" }, { value: "employer", label: "Employer Manager" }];
const dashboard = user => `/admin/${["registrar", "employer"].includes(user.admin_scope) ? user.admin_scope : "alumni"}`;

export default function AdminPortalPage({ initialMode = "login", allowExistingAdmin = false }) {
    const navigate = useNavigate();
    const [mode, setMode] = useState(initialMode);
    const [status, setStatus] = useState(null);
    const [statusError, setStatusError] = useState(null);
    const [setup, setSetup] = useState({ name: "", email: "", password: "", confirmPassword: "", admin_scope: "registrar", bootstrap_secret: "" });
    const [login, setLogin] = useState({ email: "", password: "" });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [message, setMessage] = useState("");
    const creating = useRef(false);
    const formRef = useRef(null);
    const emailRef = useRef(null);
    const focusEmailAfterOtpClose = useRef(false);
    const refreshOtp = useRef(null);
    const { notice, dismiss, validate } = useRegistrationValidation();
    const verification = useRegistrationOtp({ endpoint: "/auth/admin-registration-otp", storage: "djemc-admin-registration-gmail-session", restore: false,
        request: { body: operation => ({ admin_scope: setup.admin_scope, ...(["send", "resend"].includes(operation) ? { name: setup.name, password: setup.password } : {}) }),
            config: { headers: { "x-bootstrap-secret": setup.bootstrap_secret.trim() } } } });
    const canCreate = !!status && !status.setupComplete && status.registrationConfigured && status.registrationAvailable !== false && status.availableScopes?.length > 0;
    const registrationMessage = registrationNotice(status, statusError);
    const waitingForEmail = verification.open && !verification.verified && !verification.error && verification.secondsLeft > 0 && ["pending", "processing"].includes(verification.details?.email_status);
    useEffect(() => { refreshOtp.current = verification.refresh; }, [verification.refresh]);
    useEffect(() => {
        if (!waitingForEmail) return;
        const timer = window.setInterval(() => { void refreshOtp.current?.(); }, 5000);
        return () => window.clearInterval(timer);
    }, [waitingForEmail]);

    const loadStatus = useCallback(async () => {
        try {
            const data = await api.get("/auth/admin-setup-status");
            setStatus(data);
            setStatusError(null);
            setSetup(previous => ({ ...previous, admin_scope: data.availableScopes.includes(previous.admin_scope) ? previous.admin_scope : data.availableScopes[0] || "registrar" }));
            return data;
        } catch (failure) {
            setStatus(null);
            setStatusError(failure);
            return null;
        }
    }, []);
    useEffect(() => { void Promise.resolve().then(loadStatus); }, [loadStatus]);
    useEffect(() => {
        if (allowExistingAdmin) return;
        try {
            const user = JSON.parse(localStorage.getItem("user") || "null");
            if (user?.role === "admin") navigate(dashboard(user));
        } catch { /* An invalid saved session can sign in again. */ }
    }, [allowExistingAdmin, navigate]);

    const changeSetup = event => {
        const { name, value } = event.target;
        if (name === "email" && value.trim().toLowerCase() !== setup.email.trim().toLowerCase()) verification.clear();
        setSetup(previous => ({ ...previous, [name]: value }));
    };
    const complete = async () => {
        if (creating.current) return;
        if (!verification.verified || verification.session?.email !== setup.email.trim().toLowerCase()) {
            setError("Verify your Gmail address before creating the admin account.");
            return;
        }
        creating.current = true;
        setLoading(true);
        setError("");
        setMessage("");
        try {
            const { name, email, password, admin_scope, bootstrap_secret } = setup;
            const fields = { name, email, password, admin_scope };
            await api.post("/auth/admin-setup", { ...fields, session_token: verification.session.token, registration_authorization: verification.details.registration_authorization }, false,
                { headers: { "x-bootstrap-secret": bootstrap_secret.trim() } });
            verification.clear();
            setSetup({ name: "", email: "", password: "", confirmPassword: "", admin_scope: "registrar", bootstrap_secret: "" });
            setMessage("Admin account created. Please sign in.");
            setMode("login");
            await loadStatus();
        } catch (failure) {
            verification.setOpen(false);
            setError(failure.message);
            if (failure.status === 409) await loadStatus();
        } finally { creating.current = false; setLoading(false); }
    };
    const begin = event => {
        event.preventDefault();
        if (creating.current || loading || verification.busy) return;
        setError("");
        setMessage("");
        const requiredIssue = !setup.name.trim() ? { field: "name", title: "Name Required", message: "Please enter your name." }
            : !isRegistrationGmail(setup.email) ? { field: "email", title: "Gmail Required", message: "Enter a valid @gmail.com address." }
                : setup.password && (setup.password.length < 8 || new TextEncoder().encode(setup.password).length > 72)
                    ? { field: "password", title: "Invalid Password", message: "Use at least 8 characters and at most 72 bytes for your password." } : null;
        if (!validate(event.currentTarget, { ...setup, consent: true, requiredIssue })) return;
        if (verification.verified && verification.session?.email === setup.email.trim().toLowerCase()) void complete();
        else verification.start(setup.email);
    };
    const signIn = async event => {
        event.preventDefault(); setLoading(true); setError(""); setMessage("");
        try {
            const data = await api.post("/auth/login", login);
            if (data.user?.role !== "admin") throw new Error("This portal is for admin accounts only.");
            localStorage.setItem("token", data.token);
            localStorage.setItem("user", JSON.stringify(data.user));
            navigate(dashboard(data.user));
        } catch (failure) { setError(failure.message); }
        finally { setLoading(false); }
    };
    return <div className="auth-shell">
        <RegistrationValidationToast notice={notice} onClose={dismiss} />
        <RegistrationSuccessToast show={!!message} title="Admin Account Created Successfully!" message={message} onClose={() => setMessage("")} />
        <BackToHome />
        <div className="auth-card">
            <div className="auth-card-header"><h1>Admin Portal</h1><p>Administrator access only</p></div>
            {error && <p className="auth-error" role="alert">{error}</p>}
            {registrationMessage && <p role="status" aria-label="Admin registration availability">{registrationMessage} {statusError && <button type="button" className="inline-link-btn" onClick={() => void loadStatus()}>Retry availability</button>}</p>}
            {mode === "create" && canCreate ? <form ref={formRef} className="auth-form" onSubmit={begin} noValidate>
                <fieldset className="registration-fields" disabled={loading || verification.busy || verification.open}>
                <label className="field"><span>Secret Password</span><PasswordField name="bootstrap_secret" value={setup.bootstrap_secret} onChange={changeSetup} placeholder="Enter setup secret" required /></label>
                <label className="field"><span>Name</span><span className="line-input"><input name="name" value={setup.name} onChange={changeSetup} maxLength={255} autoComplete="name" required /></span></label>
                <label className="field"><span>Gmail</span><span className="line-input"><input ref={emailRef} type="email" name="email" value={setup.email} onChange={changeSetup} maxLength={254} autoComplete="email" placeholder="example@gmail.com" required /></span></label>
                <label className="field"><span>Password</span><PasswordField name="password" value={setup.password} onChange={changeSetup} placeholder="At least 8 characters" minLength={8} maxLength={72} autoComplete="new-password" required /></label>
                <label className="field"><span>Confirm Password</span><PasswordField name="confirmPassword" value={setup.confirmPassword} onChange={changeSetup} placeholder="Confirm your password" autoComplete="new-password" required /></label>
                <label className="field"><span>Role</span><span className="role-select-wrap"><select name="admin_scope" value={setup.admin_scope} onChange={changeSetup} required>{ROLES.map(role => <option key={role.value} value={role.value} disabled={!status.availableScopes.includes(role.value)}>{role.label}</option>)}</select></span></label>
                <button type="submit" className="primary-btn" disabled={loading || verification.busy}>{loading ? "Creating account..." : verification.verified ? "Create Account" : "Verify Gmail to create account"}</button>
                </fieldset>
                <p className="auth-footer">Already have an account? <button type="button" className="inline-link-btn" onClick={() => setMode("login")}>Sign in</button></p>
            </form> : <form className="auth-form" onSubmit={signIn}>
                <label className="field"><span>Email Address</span><span className="line-input"><input type="email" name="email" value={login.email} onChange={event => setLogin({ ...login, email: event.target.value })} autoComplete="username" required /></span></label>
                <label className="field"><span>Password</span><PasswordField name="password" value={login.password} onChange={event => setLogin({ ...login, password: event.target.value })} autoComplete="current-password" required /></label>
                <LoginButton loading={loading} />
                {canCreate && <p className="auth-footer">New admin? <button type="button" className="inline-link-btn" onClick={() => setMode("create")}>Create account</button></p>}
            </form>}
        </div>
        <RegistrationOtpModal verification={{ ...verification, busy: verification.busy || loading }} email={setup.email} admin submitting={loading}
            onContinue={() => { verification.setOpen(false); requestAnimationFrame(() => formRef.current?.requestSubmit()); }}
            onChangeEmail={() => { focusEmailAfterOtpClose.current = true; verification.clear(); }}
            onExited={() => {
                if (focusEmailAfterOtpClose.current) {
                    focusEmailAfterOtpClose.current = false;
                    requestAnimationFrame(() => { emailRef.current?.focus(); emailRef.current?.select(); });
                }
            }} />
    </div>;
}
