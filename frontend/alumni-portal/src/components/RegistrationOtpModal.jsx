import { useEffect, useRef, useState } from "react";
import { Modal, Spinner } from "react-bootstrap";

function OtpEntry({ ready, busy, verify }) {
    const [code, setCode] = useState("      ");
    const inputs = useRef([]);
    useEffect(() => {
        if (ready && !busy) inputs.current[0]?.focus();
    }, [ready, busy]);
    const fill = (value, index) => {
        const digits = value.replace(/\D/g, "").slice(0, 6);
        const start = digits.length === 6 ? 0 : index;
        const next = code.split("");
        if (!digits) next[index] = " ";
        else [...digits].forEach((digit, offset) => { if (start + offset < 6) next[start + offset] = digit; });
        setCode(next.join(""));
        if (digits) inputs.current[Math.min(5, start + digits.length)]?.focus();
    };
    return (
        <form onSubmit={event => { event.preventDefault(); if (ready && /^\d{6}$/.test(code)) void verify(code); }}>
            <p id="otp-input-label" className="form-label">Six-digit verification code</p>
            <div className="otp-digits" role="group" aria-labelledby="otp-input-label" aria-describedby="otp-expiry">
                {Array.from({ length: 6 }, (_, index) => <input key={index} ref={element => { inputs.current[index] = element; }}
                    className="form-control otp-digit" type="text" inputMode="numeric" autoComplete={index === 0 ? "one-time-code" : "off"}
                    aria-label={`Digit ${index + 1} of 6`} maxLength={6} value={code[index] === " " ? "" : code[index]}
                    disabled={busy || !ready} onFocus={event => event.target.select()}
                    onChange={event => fill(event.target.value, index)}
                    onPaste={event => { event.preventDefault(); fill(event.clipboardData.getData("text"), index); }}
                    onKeyDown={event => {
                        if (event.key === "ArrowLeft" && index > 0) { event.preventDefault(); inputs.current[index - 1]?.focus(); }
                        if (event.key === "ArrowRight" && index < 5) { event.preventDefault(); inputs.current[index + 1]?.focus(); }
                        if (event.key === "Backspace" && code[index] === " " && index > 0) {
                            event.preventDefault(); fill("", index - 1); inputs.current[index - 1]?.focus();
                        }
                    }} />)}
            </div>
            <button className="primary-btn w-100 mt-3" type="submit" disabled={busy || !ready || !/^\d{6}$/.test(code)}>Verify Gmail</button>
        </form>
    );
}

export default function RegistrationOtpModal({ verification, email, onChangeEmail, onContinue, onExited }) {
    const { open, setOpen, busy, error, verified, details, secondsLeft, cooldown, windowWait, send, verify } = verification;
    const limited = details?.resends_remaining === 0 && windowWait > 0;
    const expired = details?.status === "sent" && secondsLeft === 0;
    const locked = details?.attempts_remaining === 0;
    const ready = details?.status === "sent" && !expired && !locked;
    return (
        <Modal show={open} onHide={() => !busy && setOpen(false)} onExited={onExited} centered backdrop={busy ? "static" : true} keyboard={!busy} dialogClassName="registration-otp-modal">
            <Modal.Header closeButton={!busy}><Modal.Title>Verify your Gmail</Modal.Title></Modal.Header>
            <Modal.Body>
                <p>Verification address: <strong className="otp-email">{email.trim().toLowerCase()}</strong></p>
                <p className="text-muted small">Check your inbox and spam folder. Registrar approval is still required after registration.</p>
                {busy && <p role="status"><Spinner size="sm" animation="border" className="me-2" />Please wait...</p>}
                {error && <div className="alert alert-danger" role="alert">{error}</div>}
                {verified ? <div className="alert alert-success" role="status">Gmail verified successfully. Submit your registration within 10 minutes.</div> : <>
                    <p id="otp-expiry" className="small">
                        {details?.status === "sent" && !expired ? `Code expires in ${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}.` : "Codes expire after 5 minutes."}
                    </p>
                    {expired && <p className="text-danger" role="alert">Your code has expired. Request a new code.</p>}
                    {locked && <p className="text-danger" role="alert">Five incorrect attempts reached. Request a new code.</p>}
                    {details?.status === "verified" && !verified && <p className="text-danger" role="alert">Your verification has expired. Request a new code.</p>}
                    {details?.status === "sending" && !busy && <p role="status">Email delivery is still being processed. Close and reopen verification to check its status, or resend after the cooldown.</p>}
                    <OtpEntry key={details?.expires_at || "initial"} ready={ready} busy={busy} verify={verify} />
                    <button type="button" className="btn btn-outline-success w-100 mt-3" disabled={busy || cooldown > 0 || limited}
                        onClick={() => void send(email, true)}>
                        {limited ? `Resend limit reached - try in ${Math.ceil(windowWait / 60)} min` : cooldown > 0 ? `Resend code in ${cooldown}s` : details ? "Resend code" : "Send code"}
                    </button>
                    <p className="small text-muted mt-2 mb-0">Up to three resends per 15 minutes.</p>
                </>}
                <button type="button" className="btn btn-link text-success px-0 mt-2" disabled={busy} onClick={onChangeEmail}>Change Gmail address</button>
            </Modal.Body>
            {verified && <Modal.Footer><button type="button" className="primary-btn" onClick={onContinue}>Create Account</button></Modal.Footer>}
        </Modal>
    );
}
