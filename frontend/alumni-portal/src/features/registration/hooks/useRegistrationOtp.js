import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../services/api";

const storageKey = "djemc-registration-gmail-session";
const normalize = email => String(email || "").trim().toLowerCase();
export function readRegistrationSession(key = storageKey) {
    try {
        const saved = JSON.parse(sessionStorage.getItem(key));
        return saved && typeof saved.email === "string" && /^[a-f0-9]{64}$/.test(saved.token) ? saved : null;
    } catch { return null; }
}
const persist = (session, key = storageKey) => {
    try {
        if (session) sessionStorage.setItem(key, JSON.stringify(session));
        else sessionStorage.removeItem(key);
    } catch { /* Verification still works in memory when browser storage is disabled. */ }
};

export default function useRegistrationOtp({ endpoint = "/auth/registration-otp", storage = storageKey, request = {}, restore = true } = {}) {
    const [session, setSession] = useState(() => readRegistrationSession(storage));
    const [restored] = useState(() => !!readRegistrationSession(storage));
    const requestRef = useRef(request);
    useEffect(() => { requestRef.current = request; }, [request]);
    const post = useCallback((operation, payload) => {
        const context = requestRef.current;
        const body = typeof context.body === "function" ? context.body(operation) : context.body;
        return api.post(`${endpoint}/${operation}`, { ...body, ...payload }, false, context.config || {});
    }, [endpoint]);
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
        if (!saved || !restore) return;
        let active = true;
        const version = generation.current;
        post("status", { email: saved.email, session_token: saved.token }).then(result => {
            if (active && generation.current === version) accept(result);
        }).catch(() => {
            if (active && generation.current === version) setError("Complete the form, then request a new verification code if your previous session has expired.");
        });
        return () => { active = false; };
    }, [post, restore]);
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
            persist(current, storage);
            setDetails(null);
        }
        inFlight.current = true;
        setBusy(true);
        setError("");
        setOpen(true);
        try {
            accept(await post(resend ? "resend" : "send", { email, session_token: current.token }));
        } catch (failure) {
            setError(failure.message);
            // A timed-out request may have reserved/sent a code. Recover its
            // authoritative state without sending another email automatically.
            try { accept(await post("status", { email, session_token: current.token })); }
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
            accept(await post("verify", { email: session.email, session_token: session.token, otp: code }));
        } catch (failure) {
            setError(failure.message);
            try { accept(await post("status", { email: session.email, session_token: session.token })); }
            catch { /* Keep the verification error visible. */ }
        } finally {
            inFlight.current = false;
            setBusy(false);
        }
    };
    const clear = () => {
        generation.current += 1;
        persist(null, storage);
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
    const refresh = async () => {
        if (!session || inFlight.current) return;
        inFlight.current = true;
        setBusy(true);
        setError("");
        try { accept(await post("status", { email: session.email, session_token: session.token })); }
        catch (failure) { setError(failure.message); }
        finally { inFlight.current = false; setBusy(false); }
    };
    return { session, details, open, setOpen, busy, error, verified, secondsLeft, cooldown, windowWait, send, verify, clear, start, restored, refresh };
}
