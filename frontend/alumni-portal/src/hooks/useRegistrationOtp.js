import { useEffect, useRef, useState } from "react";
import { api } from "../services/api";

const storageKey = "djemc-registration-gmail-session";
const normalize = email => String(email || "").trim().toLowerCase();
export function readRegistrationSession() {
    try {
        const saved = JSON.parse(sessionStorage.getItem(storageKey));
        return saved && typeof saved.email === "string" && /^[a-f0-9]{64}$/.test(saved.token) ? saved : null;
    } catch { return null; }
}
const persist = session => {
    try {
        if (session) sessionStorage.setItem(storageKey, JSON.stringify(session));
        else sessionStorage.removeItem(storageKey);
    } catch { /* Verification still works in memory when browser storage is disabled. */ }
};

export default function useRegistrationOtp() {
    const [session, setSession] = useState(readRegistrationSession);
    const [restored] = useState(() => !!readRegistrationSession());
    const [details, setDetails] = useState(null);
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [clock, setClock] = useState(() => Date.now());
    const [serverOffset, setServerOffset] = useState(0);
    const inFlight = useRef(false);
    const initialSession = useRef(session);
    const generation = useRef(0);
    const accept = result => {
        setServerOffset(new Date(result.server_time).getTime() - Date.now());
        setDetails(result);
        setClock(Date.now());
    };
    useEffect(() => {
        const timer = setInterval(() => setClock(Date.now()), 1000);
        return () => clearInterval(timer);
    }, []);
    useEffect(() => {
        const saved = initialSession.current;
        if (!saved) return;
        let active = true;
        const version = generation.current;
        api.post("/auth/registration-otp/status", { email: saved.email, session_token: saved.token }).then(result => {
            if (active && generation.current === version) accept(result);
        }).catch(() => {
            if (active && generation.current === version) setError("Complete the form, then request a new verification code if your previous session has expired.");
        });
        return () => { active = false; };
    }, []);
    const time = clock + serverOffset;
    const verified = !!details?.verified && time < new Date(details.verification_expires_at).getTime();
    const secondsLeft = Math.max(0, Math.ceil((new Date(details?.expires_at || 0).getTime() - time) / 1000));
    const cooldown = Math.max(0, Math.ceil((new Date(details?.resend_at || 0).getTime() - time) / 1000));
    const windowWait = Math.max(0, Math.ceil((new Date(details?.send_window_resets_at || 0).getTime() - time) / 1000));
    const send = async (emailValue, resend = false) => {
        if (inFlight.current) return;
        const email = normalize(emailValue);
        let current = session;
        if (!current || current.email !== email) {
            current = { email, token: Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join("") };
            setSession(current);
            persist(current);
            setDetails(null);
        }
        inFlight.current = true;
        setBusy(true);
        setError("");
        setOpen(true);
        try {
            accept(await api.post(`/auth/registration-otp/${resend ? "resend" : "send"}`, { email, session_token: current.token }));
        } catch (failure) {
            setError(failure.message);
            // A timed-out request may have reserved/sent a code. Recover its
            // authoritative state without sending another email automatically.
            try { accept(await api.post("/auth/registration-otp/status", { email, session_token: current.token })); }
            catch { /* Keep the send error visible. */ }
        } finally {
            inFlight.current = false;
            setBusy(false);
        }
    };
    const verify = async code => {
        if (inFlight.current || !session) return;
        inFlight.current = true;
        setBusy(true);
        setError("");
        try {
            accept(await api.post("/auth/registration-otp/verify", { email: session.email, session_token: session.token, otp: code }));
        } catch (failure) {
            setError(failure.message);
            try { accept(await api.post("/auth/registration-otp/status", { email: session.email, session_token: session.token })); }
            catch { /* Keep the verification error visible. */ }
        } finally {
            inFlight.current = false;
            setBusy(false);
        }
    };
    const clear = () => {
        generation.current += 1;
        persist(null);
        setSession(null);
        setDetails(null);
        setError("");
        setOpen(false);
    };
    const start = email => {
        // The backend reuses an active challenge on this endpoint. Reopening
        // also recovers an ambiguous/time-out response without duplicate mail.
        void send(email);
    };
    return { session, details, open, setOpen, busy, error, verified, secondsLeft, cooldown, windowWait, send, verify, clear, start, restored };
}
