import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../services/api";
import MembershipApplicationModal from "../components/membership/MembershipApplicationModal";
import { MembershipFlowContext } from "./membershipFlow";

export default function MembershipFlowProvider({ user, children }) {
    const location = useLocation();
    const navigate = useNavigate();
    const [data, setData] = useState(null);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(true);
    const [retry, setRetry] = useState(0);
    const [opened, setOpened] = useState(false);
    const generation = useRef(0);
    const isAlumni = user?.role === "alumni";
    const open = isAlumni && (opened || location.state?.openMembershipApplication === true);

    useEffect(() => {
        if (!isAlumni) return;
        let active = true;
        const request = ++generation.current;
        async function load() {
            setLoading(true);
            try {
                const response = await api.get("/membership/me", true);
                if (!response || typeof response.completion?.submitted !== "boolean") throw new Error("Membership information could not be loaded.");
                if (active && request === generation.current) { setData({ ...response, eligible: true }); setError(""); }
            } catch (failure) {
                if (!active || request !== generation.current) return;
                if ([401, 403].includes(failure.status)) { setData({ eligible: false }); setError(""); }
                else setError(failure.message || "Membership information could not be loaded.");
            } finally { if (active && request === generation.current) setLoading(false); }
        }
        load();
        return () => { active = false; };
    }, [isAlumni, user?.id, location.pathname, retry]);

    const close = () => {
        setOpened(false);
        if (location.state?.openMembershipApplication) navigate(location.pathname, { replace: true, state: { ...location.state, openMembershipApplication: false } });
    };
    const confirmedSave = response => {
        if (!response?.application?.id || typeof response.completion?.submitted !== "boolean") return;
        ++generation.current;
        setData(previous => ({ ...previous, ...response, eligible: true }));
        setError(""); setLoading(false);
    };
    return <MembershipFlowContext.Provider value={{ data, error, loading, open, openForm: () => setOpened(true), retry: () => setRetry(value => value + 1) }}>
        {children}
        {open && data?.eligible !== false && <MembershipApplicationModal onClose={close} onConfirmedSave={confirmedSave} />}
    </MembershipFlowContext.Provider>;
}
