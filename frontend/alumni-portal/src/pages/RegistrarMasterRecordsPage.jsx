import React, { useEffect, useMemo, useState } from "react";
import { Button, Card, Form, Table, Toast } from "react-bootstrap";
import { Link, useNavigate } from "react-router-dom";
import AdminShell from "../components/AdminShell";
import useRenderDebug from "../hooks/useRenderDebug";
import { api } from "../services/api";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

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

function getFullName(u) {
    return u?.full_name || u?.name || "";
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

    const [query, setQuery] = useState("");
    const [pageSize, setPageSize] = useState(PAGE_SIZE_OPTIONS[0]);
    const [page, setPage] = useState(1);

    const loadRecords = async () => {
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

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return allRecords;

        return allRecords.filter((item) => {
            const full = getFullName(item).toLowerCase();
            const course = String(item?.course ?? "").toLowerCase();
            const batch = String(item?.batch_year ?? item?.batch ?? "").toLowerCase();
            const address = getCurrentAddress(item).toLowerCase();

            return (
                full.includes(q) ||
                course.includes(q) ||
                batch.includes(q) ||
                address.includes(q)
            );
        });
    }, [allRecords, query]);

    const total = filtered.length;
    const pageCount = Math.max(1, Math.ceil(total / pageSize));

    useEffect(() => {
        setPage(1);
    }, [query, pageSize]);

    const paged = useMemo(() => {
        const start = (page - 1) * pageSize;
        return filtered.slice(start, start + pageSize);
    }, [filtered, page, pageSize]);

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
            title="Master Records"
            subtitle="Search and manage the official master alumni list."
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

            <Card className="queue-panel h-100" style={{ borderRadius: 16 }}>
                <Card.Body>
                    <div className="panel-header" style={{ marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <h2 style={{ margin: 0 }}>Master Records</h2>
                        <span>{loading ? "" : `${total} alumni`}</span>
                    </div>

                    <div className="d-flex gap-2 flex-wrap align-items-center" style={{ marginBottom: 12 }}>
                        <Form.Control
                            className="saas-input"
                            placeholder="Search name, course, batch..."
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                        />

                        <Button
                            variant="outline-secondary"
                            size="sm"
                            onClick={loadRecords}
                            disabled={loading}
                        >
                            {loading ? "Loading..." : "Refresh"}
                        </Button>

                        <Form.Select
                            style={{ width: 140 }}
                            value={pageSize}
                            onChange={(e) => setPageSize(Number(e.target.value))}
                        >
                            {PAGE_SIZE_OPTIONS.map((s) => (
                                <option key={s} value={s}>
                                    {s} / page
                                </option>
                            ))}
                        </Form.Select>
                    </div>

                    {loading ? (
                        <p className="text-muted">Loading...</p>
                    ) : total === 0 ? (
                        <p className="empty">No master records found.</p>
                    ) : (
                        <Table responsive hover>
                            <thead>
                                <tr>
                                    <th>Full Name</th>
                                    <th>Course</th>
                                    <th>Batch</th>
                                    <th>Current Address</th>
                                    <th>Employment</th>
                                </tr>
                            </thead>
                            <tbody>
                                {paged.map((item) => {
                                    const employmentLabel = getEmploymentDisplay(item);
                                    const addressLabel = getCurrentAddress(item);

                                    console.log("[TABLE_ROW]", item.full_name, { course: item.course, batch_year: item.batch_year, address: addressLabel, employment: employmentLabel });

                                    return (
                                        <tr key={item.id}>
                                            <td>{getFullName(item)}</td>
                                            <td>{item.course ?? "—"}</td>
                                            <td>
                                                {(() => {
                                                    const batch =
                                                        item?.batch_year ??
                                                        item?.batch ??
                                                        "—";

                                                    return String(batch);
                                                })()}
                                            </td>
                                            <td>{addressLabel}</td>
                                            <td>{employmentLabel}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </Table>
                    )}

                    {!loading && total > 0 ? (
                        <div className="d-flex justify-content-between align-items-center mt-3">
                            <Button
                                variant="outline-secondary"
                                disabled={page <= 1}
                                onClick={() => setPage((p) => Math.max(1, p - 1))}
                            >
                                Prev
                            </Button>
                            <div className="text-muted">
                                Page {page} of {pageCount}
                            </div>
                            <Button
                                variant="outline-secondary"
                                disabled={page >= pageCount}
                                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                            >
                                Next
                            </Button>
                        </div>
                    ) : null}
                </Card.Body>
            </Card>
        </AdminShell>
    );
}

