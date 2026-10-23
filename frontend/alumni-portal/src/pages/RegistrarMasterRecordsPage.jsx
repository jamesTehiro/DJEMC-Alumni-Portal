import React, { useEffect, useMemo, useState } from "react";
import { Button, Toast } from "react-bootstrap";
import { FiRefreshCw } from "react-icons/fi";
import MasterAlumniRecordsPanel from "../components/MasterAlumniRecordsPanel";
import { Link, useNavigate } from "react-router-dom";
import AdminShell from "../components/AdminShell";
import useRenderDebug from "../hooks/useRenderDebug";
import { api } from "../services/api";

function getEmploymentNormalized(raw) {
    const s = raw == null ? "" : String(raw).trim().toLowerCase();
    if (!s || s === "not specified") return "Not specified";
    if (s === "unemployed") return "Unemployed";
    if (s === "employed") return "Employed";
    if (s === "self-employed" || s === "self employed") return "Self-Employed";
    return "Not specified";
}

function getEmploymentDisplay(item) {
    const currentCompany = item?.User?.AlumniProfile?.current_company;
    const jobTitle = item?.User?.AlumniProfile?.job_title;
    const employmentStatus = item?.User?.AlumniProfile?.employment_status;

    if (currentCompany) {
        return jobTitle ? `${jobTitle} • ${currentCompany}` : currentCompany;
    }
    if (employmentStatus) {
        return getEmploymentNormalized(employmentStatus);
    }
    return "Not specified";
}

function getCurrentAddress(item) {
    const address = item?.User?.AlumniProfile?.address;
    return address && address.trim() ? address : "Not provided";
}

export default function RegistrarMasterRecordsPage() {
    useRenderDebug("RegistrarMasterRecordsPage");
    const navigate = useNavigate();

    const user = useMemo(() => {
        try {
            return JSON.parse(localStorage.getItem("user") || "null");
        } catch {
            return null;
        }
    }, []);

    const isAllowed = user?.role === "admin" && user?.admin_scope === "registrar";

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [toast, setToast] = useState({ show: false, message: "", type: "" });
    const [allRecords, setAllRecords] = useState([]);

    const loadRecords = async () => {
        setLoading(true);
        try {
            const data = await api.get("/alumni-records", true);
            const items = Array.isArray(data) ? data : [];
            setAllRecords(items);
            setError("");
        } catch (e) {
            const errMsg = e?.message || "Failed to load master records";
            setError(errMsg);
            if (e?.status === 409) {
                setToast({ show: true, message: "Duplicate alumni record detected", type: "warning" });
            }
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!isAllowed) return;
        setLoading(true);
        loadRecords();
    }, [isAllowed]);

    const handleLogout = () => {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        navigate("/");
    };

    if (!isAllowed) {
        return (
            <div className="admin-employer-shell">
                <div className="admin-employer-center">
                    <div className="admin-employer-card">
                        <h3>Registrar Admin Access Only</h3>
                        <p>Please log in using a Registrar Admin account.</p>
                        <Link to="/admin/login">Go to Login</Link>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <AdminShell
            scope="registrar"
            title="Official Alumni Records"
            subtitle="Search and manage the official alumni list."
            eyebrow="Registrar Console"
            onLogout={handleLogout}
        >
            {error ? <p className="notice error">{error}</p> : null}

            <Toast
                show={toast.show}
                onClose={() => setToast({ ...toast, show: false })}
                delay={3000}
                autohide
                style={{
                    position: "fixed",
                    top: 20,
                    right: 20,
                    zIndex: 1050
                }}
            >
                <Toast.Body className={`bg-warning text-dark`}>
                    {toast.message}
                </Toast.Body>
            </Toast>

            <MasterAlumniRecordsPanel
                records={allRecords}
                loading={loading}
                actions={<Button variant="outline-success" onClick={loadRecords} disabled={loading}><FiRefreshCw aria-hidden="true" />{loading ? "Loading?" : "Refresh Records"}</Button>}
                detailColumns={[
                    { label: "Current Address", render: getCurrentAddress },
                    { label: "Employment", render: getEmploymentDisplay }
                ]}
            />
        </AdminShell>
    );
}

