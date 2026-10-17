import React, { useEffect, useMemo, useState, useRef } from "react";
import { Link } from "react-router-dom";
import { Button, Card, Form, Table } from "react-bootstrap";
import AdminShell from "../components/AdminShell";
import useRenderDebug from "../hooks/useRenderDebug";
import useRegistrarAdminData from "./registrar/useRegistrarAdminData";
import { Doughnut } from "react-chartjs-2";
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from "chart.js";
import "./AdminEmployerPage.css";
import "./RegistrarDashboardPage.css";

ChartJS.register(ArcElement, Tooltip, Legend);

const PAGE_SIZE_OPTIONS = [10, 20, 50];

const DJEMC_GREEN_PRIMARY = "#0f7a43";
const DJEMC_GREEN_SECONDARY = "#2d9c5a";
const DJEMC_GREEN_LIGHT = "#7bc67b";
const DJEMC_GRAY = "#d9d9d9";

function getFullName(u) {
    return u?.full_name || u?.name || "";
}

function DoughnutChartPanel({ insights, loading }) {
    const chartRef = useRef(null);
    const { employed, unemployed, self_employed } = insights;
    const total = employed + unemployed + self_employed;

    const percentages = useMemo(() => {
        if (total === 0) return { employed: 0, unemployed: 0, self_employed: 0 };
        return {
            employed: ((employed / total) * 100),
            unemployed: ((unemployed / total) * 100),
            self_employed: ((self_employed / total) * 100)
        };
    }, [employed, unemployed, self_employed, total]);

    const chartData = {
        labels: ["Employed", "Unemployed", "Self-Employed"],
        datasets: [
            {
                data: [employed, unemployed, self_employed],
                backgroundColor: [DJEMC_GREEN_PRIMARY, DJEMC_GRAY, DJEMC_GREEN_LIGHT],
                borderColor: ["#ffffff", "#ffffff", "#ffffff"],
                borderWidth: 3,
                hoverOffset: 12
            }
        ]
    };

    const chartOptions = {
        cutout: "72%",
        responsive: true,
        maintainAspectRatio: true,
        animation: {
            animateRotate: true,
            duration: 1200,
            easing: "easeOutQuart"
        },
        plugins: {
            legend: {
                display: false
            },
            tooltip: {
                backgroundColor: "rgba(15, 122, 67, 0.95)",
                titleFont: { weight: "700", size: 14 },
                bodyFont: { size: 13 },
                padding: 12,
                cornerRadius: 8,
                callbacks: {
                    label: function (context) {
                        const val = context.raw;
                        const pct = total > 0 ? ((val / total) * 100).toFixed(1) : 0;
                        return `${context.label}: ${val} (${pct}%)`;
                    }
                }
            }
        }
    };

    if (loading) {
        return (
            <div className="doughnut-chart-panel">
                <p className="text-muted" style={{ textAlign: "center", padding: "60px 0" }}>Loading...</p>
            </div>
        );
    }

    if (total === 0) {
        return (
            <div className="doughnut-chart-panel">
                <div className="doughnut-empty-state">
                    <div className="doughnut-empty-icon">📊</div>
                    <p className="doughnut-empty-text">No employment data available</p>
                    <p className="doughnut-empty-sub">Employment insights will appear once alumni profiles are updated with employment status.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="doughnut-chart-panel">
            <div className="doughnut-chart-wrapper">
                <div className="doughnut-chart-container">
                    <Doughnut ref={chartRef} data={chartData} options={chartOptions} />
                    <div className="doughnut-center-label">
                        <div className="doughnut-center-title">Employment</div>
                        <div className="doughnut-center-subtitle">Insights</div>
                        <div className="doughnut-center-total-label">Total Alumni</div>
                        <div className="doughnut-center-total-count">{total}</div>
                    </div>
                </div>
            </div>

            <div className="doughnut-legend">
                {[
                    { label: "Employed", value: employed, pct: percentages.employed, color: DJEMC_GREEN_PRIMARY },
                    { label: "Unemployed", value: unemployed, pct: percentages.unemployed, color: DJEMC_GRAY },
                    { label: "Self-Employed", value: self_employed, pct: percentages.self_employed, color: DJEMC_GREEN_LIGHT }
                ].map((item) => (
                    <div key={item.label} className="doughnut-legend-item">
                        <span className="doughnut-legend-dot" style={{ background: item.color }} />
                        <span className="doughnut-legend-label">{item.label}</span>
                        <span className="doughnut-legend-value">{item.value}</span>
                        <span className="doughnut-legend-pct">{item.pct.toFixed(1)}%</span>
                    </div>
                ))}
            </div>

            <div className="doughnut-stats-section">
                <h4 className="doughnut-stats-title">Quick Statistics</h4>
                <div className="doughnut-stats-grid mobile-scroll-cards">
                    <div className="doughnut-stat-card">
                        <div className="doughnut-stat-value" style={{ color: DJEMC_GREEN_PRIMARY }}>{percentages.employed.toFixed(1)}%</div>
                        <div className="doughnut-stat-label">Employed</div>
                    </div>
                    <div className="doughnut-stat-card">
                        <div className="doughnut-stat-value" style={{ color: "#888" }}>{percentages.unemployed.toFixed(1)}%</div>
                        <div className="doughnut-stat-label">Unemployed</div>
                    </div>
                    <div className="doughnut-stat-card">
                        <div className="doughnut-stat-value" style={{ color: DJEMC_GREEN_LIGHT }}>{percentages.self_employed.toFixed(1)}%</div>
                        <div className="doughnut-stat-label">Self-Employed</div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function RegistrarEmploymentAnalytics({ courseCounts = [] }) {
    const [loading, setLoading] = React.useState(true);
    const [employmentInsights, setEmploymentInsights] = React.useState({ employed: 0, unemployed: 0, self_employed: 0 });
    const [error, setError] = React.useState("");

    React.useEffect(() => {
        let cancelled = false;

        // Spec: ignore null/empty/Not specified and only count allowed values
        const ignoreStatuses = new Set(["", "null", "not specified"]);
        const isValid = (s) => {
            const normalized = String(s ?? "").trim().toLowerCase();
            if (ignoreStatuses.has(normalized)) return false;
            return normalized === "employed" || normalized === "unemployed" || normalized === "self-employed";
        };

        const toNormalizedEmployment = (s) => String(s ?? "").trim().toLowerCase();
        const user = (() => {
            try {
                return JSON.parse(localStorage.getItem("user") || "null");
            } catch {
                return null;
            }
        })();

        const isAllowed = user?.role === "admin" && user?.admin_scope === "registrar";
        if (!isAllowed) return;

        const load = async () => {
            setLoading(true);
            setError("");
            try {
                const { api } = await import("../services/api");
                const analytics = await api.get("/registrar/analytics", true);

                if (cancelled) return;
                setEmploymentInsights({
                    employed: Number(analytics.employedAlumni || 0),
                    unemployed: Number(analytics.unemployedAlumni || 0),
                    self_employed: Number(analytics.selfEmployedAlumni || 0)
                });
            } catch (e) {
                if (cancelled) return;
                setError(e?.message || "Failed to load analytics data");
            }

            if (!cancelled) {
                setLoading(false);
            }
        };

        load();
        return () => {
            cancelled = true;
        };
    }, []);

    const max = Math.max(1, employmentInsights.employed, employmentInsights.unemployed, employmentInsights.self_employed);

    return (
        <section className="analytics-default">
            {error ? <p className="notice error">{error}</p> : null}
            <div className="employment-analytics-layout">
                {/* LEFT PANEL - Employment Status */}
                <div className="employment-status-panel">
                    <div className="p-3">
                        <h3 className="employment-status-title">Employment Status</h3>
                        {loading ? null : (
                            <div style={{ display: "grid", gap: 12 }}>
                                {[
                                    { label: "Employed", value: employmentInsights.employed, color: DJEMC_GREEN_PRIMARY },
                                    { label: "Unemployed", value: employmentInsights.unemployed, color: DJEMC_GRAY },
                                    { label: "Self-Employed", value: employmentInsights.self_employed, color: DJEMC_GREEN_LIGHT }
                                ].map((row) => {
                                    const pct = (row.value / max) * 100;
                                    return (
                                        <div key={row.label} style={{ display: "grid", gap: 6 }}>
                                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                                <span className="employ-status-label">{row.label}</span>
                                                <span className="employ-count-value">{row.value}</span>
                                            </div>
                                            <div style={{ height: 10, background: "rgba(0,0,0,0.06)", borderRadius: 999 }}>
                                                <div
                                                    style={{
                                                        width: `${pct}%`,
                                                        height: "100%",
                                                        background: row.color,
                                                        borderRadius: 999,
                                                        transition: "width 250ms ease"
                                                    }}
                                                />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {loading ? <p className="text-muted">Loading...</p> : null}

                        {!loading ? (
                            <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid rgba(0,0,0,0.06)" }}>
                                <div style={{ display: "grid", gap: 10 }}>
                                    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                                        <div style={{ background: "rgba(7, 115, 59, 0.10)", padding: 12, borderRadius: 12, minWidth: 180 }}>
                                            <div className="employ-totals-heading">Totals</div>
                                            <div className="employ-totals-value">
                                                {employmentInsights.employed + employmentInsights.unemployed + employmentInsights.self_employed}
                                            </div>
                                        </div>
                                        <div style={{ background: "rgba(27, 111, 82, 0.10)", padding: 12, borderRadius: 12, minWidth: 180 }}>
                                            <div className="employ-summary-heading">Summary</div>
                                            <div className="employ-summary-text">
                                                {employmentInsights.employed} employed • {employmentInsights.unemployed} unemployed • {employmentInsights.self_employed} self-employed
                                            </div>
                                        </div>
                                    </div>

                                    {!loading && courseCounts.length > 0 ? (
                                        <div style={{ paddingTop: 12, borderTop: "1px solid rgba(0,0,0,0.06)", marginTop: 4 }}>
                                            <div className="employ-course-heading">Alumni per Course</div>
                                            <div style={{ display: "grid", gap: 6 }}>
                                                {courseCounts.map((item) => (
                                                    <div key={item.course} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0" }}>
                                                        <span className="employ-course-name">{item.course}</span>
                                                        <span className="employ-course-count">{item.count}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    ) : null}
                                </div>
                            </div>
                        ) : null}
                    </div>
                </div>

                {/* RIGHT PANEL - Doughnut Chart */}
                <div className="doughnut-panel-wrapper">
                    <div className="p-3">
                        <h3 className="employment-status-title">Employment Distribution</h3>
                        <DoughnutChartPanel insights={employmentInsights} loading={loading} />
                    </div>
                </div>
            </div>
        </section>
    );
}

function normalizeStatus(status) {
    if (status == null) return "";
    return String(status).trim().toLowerCase();
}

function getPendingYear(item) {
    return item?.AlumniProfile?.graduation_year ?? item?.graduation_year ?? "—";
}

function getPendingCourse(item) {
    return item?.AlumniProfile?.course ?? item?.course ?? "—";
}

function getEmploymentNormalized(raw) {
    const s = raw == null ? "" : String(raw).trim().toLowerCase();
    if (!s || s === "not specified") return "Not specified";
    if (s === "employed") return "Employed";
    if (s === "unemployed") return "Unemployed";
    if (s === "self-employed" || s === "self employed") return "Self-employed";
    // If backend returns unexpected casing/spelling, fall back to Not specified
    return "Not specified";
}

function getMasterCurrentAddress(row) {
    // /alumni-records returns AlumniRecord with User → AlumniProfile nesting
    const userProfile = row?.User?.AlumniProfile;
    const address =
        userProfile?.address ??
        row?.AlumniProfile?.address ??
        row?.address ??
        null;

    return address && String(address).trim() ? String(address).trim() : "Not provided";
}

function getMasterEmploymentValue(row) {
    // /alumni-records returns AlumniRecord with User → AlumniProfile nesting
    const profile = row?.User?.AlumniProfile ?? row?.AlumniProfile;
    const currentCompany = profile?.current_company;
    const jobTitle = profile?.job_title;
    const employment = profile?.employment_status;

    console.log("[MASTER employment]", row.full_name, profile);

    if (currentCompany) {
        return jobTitle ? `${jobTitle} • ${currentCompany}` : currentCompany;
    }

    if (employment) {
        return employment
            .replace("-", " ")
            .replace(/\b\w/g, (c) => c.toUpperCase());
    }

    return "Not specified";
}



function PendingAlumniPanel() {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [allPending, setAllPending] = useState([]);

    const [query, setQuery] = useState("");
    const [pageSize, setPageSize] = useState(PAGE_SIZE_OPTIONS[0]);
    const [page, setPage] = useState(1);

    const user = useMemo(() => {
        try {
            return JSON.parse(localStorage.getItem("user") || "null");
        } catch {
            return null;
        }
    }, []);

    const isAllowed = user?.role === "admin" && user?.admin_scope === "registrar";

    useEffect(() => {
        if (!isAllowed) return;

        const load = async () => {
            setLoading(true);
            setError("");
            try {
                const { api } = await import("../services/api");
                const data = await api.get("/users/pending", true);
                const items = Array.isArray(data) ? data : [];

                const filtered = items.filter((item) => {
                    const s = normalizeStatus(item?.status) || normalizeStatus(item?.account_status) || normalizeStatus(item?.accountStatus);
                    return s === "pending";
                });

                setAllPending(filtered);
            } catch (e) {
                setError(e?.message || "Failed to load pending alumni");
            } finally {
                setLoading(false);
            }
        };

        load();
    }, [isAllowed]);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return allPending;
        return allPending.filter((item) => {
            const full = getFullName(item).toLowerCase();
            const year = String(getPendingYear(item)).toLowerCase();
            const course = String(getPendingCourse(item)).toLowerCase();
            return full.includes(q) || year.includes(q) || course.includes(q);
        });
    }, [allPending, query]);

    const total = filtered.length;
    const pageCount = Math.max(1, Math.ceil(total / pageSize));

    useEffect(() => {
        setPage(1);
    }, [query, pageSize]);

    const paged = useMemo(() => {
        const start = (page - 1) * pageSize;
        return filtered.slice(start, start + pageSize);
    }, [filtered, page, pageSize]);

    return (
        <Card className="queue-panel h-100" style={{ borderRadius: 16 }}>
            <Card.Body>
                <div className="panel-header" style={{ marginBottom: 12 }}>
                    <h2 style={{ margin: 0 }}>Pending Alumni</h2>
                    <span>{loading ? "" : `${total} pending`}</span>
                </div>

                <div className="d-flex gap-2 flex-wrap align-items-center" style={{ marginBottom: 12 }}>
                    <Form.Control
                        className="saas-input"
                        placeholder="Search full name, year, or course..."
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                    />

                    <Form.Select style={{ width: 140 }} value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
                        {PAGE_SIZE_OPTIONS.map((s) => (
                            <option key={s} value={s}>
                                {s} / page
                            </option>
                        ))}
                    </Form.Select>
                </div>

                {error ? <p className="notice error">{error}</p> : null}

                {loading ? (
                    <p className="text-muted">Loading...</p>
                ) : total === 0 ? (
                    <p className="empty">No pending alumni found.</p>
                ) : (
                    <Table responsive hover>
                        <thead>
                            <tr>
                                <th>Full Name</th>
                                <th>Year</th>
                                <th>Course</th>
                            </tr>

                        </thead>
                        <tbody>
                            {paged.map((item) => (
                                <tr key={item.id}>
                                    <td>{getFullName(item)}</td>
                                    <td>{getPendingYear(item)}</td>
                                    <td>{getPendingCourse(item)}</td>

                                </tr>
                            ))}
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
    );
}




function getMasterCourse(item) {
    return item?.course ?? "—";
}

function getMasterBatch(item) {
    return item?.batch_year ?? item?.batch ?? "—";
}

function getMasterEmploymentRaw(item) {
    return item?.AlumniProfile?.employment_status ?? item?.employment_status ?? "Not specified";
}

function getAccountStatus(item) {
    const user = item?.User;
    if (!user) return "No Account";
    if (user.account_status === "active" || user.account_status === "Active") return "Active";
    if (user.account_status === "pending") return "Pending";
    if (user.account_status === "inactive" || user.account_status === "deactivated" || user.account_status === "suspended") return "Inactive";
    if (user.account_status) return user.account_status.charAt(0).toUpperCase() + user.account_status.slice(1);
    return "Active";
}

function MasterRecordsPanel() {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [allRecords, setAllRecords] = useState([]);

    const [query, setQuery] = useState("");
    const [pageSize, setPageSize] = useState(PAGE_SIZE_OPTIONS[0]);
    const [page, setPage] = useState(1);

    const user = useMemo(() => {
        try {
            return JSON.parse(localStorage.getItem("user") || "null");
        } catch {
            return null;
        }
    }, []);

    const isAllowed = user?.role === "admin" && user?.admin_scope === "registrar";

    useEffect(() => {
        if (!isAllowed) return;

        const load = async () => {
            setLoading(true);
            setError("");
            try {
                const { api } = await import("../services/api");
                const data = await api.get("/alumni-records", true);
                const items = Array.isArray(data) ? data : [];

                console.log("master list rows", items);
                setAllRecords(items);
            } catch (e) {
                setError(e?.message || "Failed to load master records");
            } finally {
                setLoading(false);
            }
        };

        load();
    }, [isAllowed]);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return allRecords;

        return allRecords.filter((item) => {
            const full = getFullName(item).toLowerCase();
            const course = String(getMasterCourse(item)).toLowerCase();
            const batch = String(getMasterBatch(item)).toLowerCase();
            const address = getMasterCurrentAddress(item).toLowerCase();
            const employment = getMasterEmploymentValue(item).toLowerCase();
            return full.includes(q) || course.includes(q) || batch.includes(q) || address.includes(q) || employment.includes(q);
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

    return (
        <Card className="queue-panel h-100" style={{ borderRadius: 16 }}>
            <Card.Body>
                <div className="panel-header" style={{ marginBottom: 12 }}>
                    <h2 style={{ margin: 0 }}>Master Records</h2>
                    <span>{loading ? "" : `${total} alumni`}</span>
                </div>

                <div className="d-flex gap-2 flex-wrap align-items-center" style={{ marginBottom: 12 }}>
                    <Form.Control
                        className="saas-input"
                        placeholder="Search name, course, batch, address, employment..."
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                    />

                    <Form.Select style={{ width: 140 }} value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
                        {PAGE_SIZE_OPTIONS.map((s) => (
                            <option key={s} value={s}>
                                {s} / page
                            </option>
                        ))}
                    </Form.Select>
                </div>

                {error ? <p className="notice error">{error}</p> : null}

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
                                <th>Employment Status</th>
                                <th>Account Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {paged.map((row) => {
                                return (
                                    <tr key={row.id}>
                                        <td>{getFullName(row)}</td>
                                        <td>{getMasterCourse(row)}</td>
                                        <td>{getMasterBatch(row)}</td>
                                        <td>{getMasterCurrentAddress(row)}</td>
                                        <td>{getMasterEmploymentValue(row)}</td>
                                        <td>{getAccountStatus(row)}</td>
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
    );
}

export default function RegistrarDashboardPage() {
    useRenderDebug("RegistrarDashboardPage");
    const { isAllowed, pendingUsers, records, message, error, courseCounts } = useRegistrarAdminData();

    const [activePanel, setActivePanel] = useState("analytics");

    const handleLogout = () => {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        window.location.href = "/";
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
            title="Registrar Officer"
            subtitle="Monitor verification activity, review quick matches, and keep the alumni master list within reach."
            eyebrow="Registrar Console"
            onLogout={handleLogout}
        >
            {message && <p className="notice success">{message}</p>}
            {error && <p className="notice error">{error}</p>}

            <section className="registrar-dashboard-cards mobile-scroll-cards">
                <button
                    type="button"
                    className="registrar-dashboard-card registrar-card-pending"
                    onClick={() => setActivePanel("pending")}
                >
                    <div className="registrar-dashboard-card-label">Pending Alumni</div>
                    <div className="registrar-dashboard-card-count">{pendingUsers.length}</div>
                </button>

                <button
                    type="button"
                    className="registrar-dashboard-card registrar-card-master"
                    onClick={() => setActivePanel("master")}
                >
                    <div className="registrar-dashboard-card-label">Master Records</div>
                    <div className="registrar-dashboard-card-count">{records.length}</div>
                </button>

                <button
                    type="button"
                    className="registrar-dashboard-card registrar-card-analytics"
                    onClick={() => setActivePanel("analytics")}
                >
                    <div className="registrar-dashboard-card-label">Analytics</div>
                    <div className="registrar-dashboard-card-count">Employment Insights</div>
                </button>
            </section>

            {activePanel === "analytics" && <RegistrarEmploymentAnalytics courseCounts={courseCounts} />}
            {activePanel === "pending" && <PendingAlumniPanel />}
            {activePanel === "master" && <MasterRecordsPanel />}
        </AdminShell>
    );
}
