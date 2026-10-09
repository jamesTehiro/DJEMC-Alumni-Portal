import React, { useEffect, useMemo, useState } from "react";
import { Card, Spinner } from "react-bootstrap";
import AdminShell from "../components/AdminShell";
import useRenderDebug from "../hooks/useRenderDebug";
import { api } from "../services/api";

export default function RegistrarAnalyticsPage() {
    useRenderDebug("RegistrarAnalyticsPage");

    const user = useMemo(() => {
        try {
            return JSON.parse(localStorage.getItem("user") || "null");
        } catch {
            return null;
        }
    }, []);

    const isAllowed = user?.role === "admin" && user?.admin_scope === "registrar";

    const [loading, setLoading] = useState(true);
    const [employmentInsights, setEmploymentInsights] = useState({ employed: 0, unemployed: 0, self_employed: 0 });
    const [error, setError] = useState("");

    useEffect(() => {
        if (!isAllowed) return;

        const load = async () => {
            setLoading(true);
            setError("");
            try {
                // Prefer an existing endpoint that already supports registrar analytics.
                // If not available, this should be adjusted to the correct alumni profile endpoint.
                const profilesRes = await api.get("/profiles", true);
                const profiles = Array.isArray(profilesRes) ? profilesRes : [];

                let employed = 0;
                let unemployed = 0;
                let selfEmployed = 0;

                for (const p of profiles) {
                    const status = p?.employment_status;
                    if (!status) continue;
                    if (status === "employed") employed += 1;
                    else if (status === "unemployed") unemployed += 1;
                    else if (status === "self-employed") selfEmployed += 1;
                }

                setEmploymentInsights({ employed, unemployed, self_employed: selfEmployed });
            } catch (e) {
                setError(e?.message || "Failed to load analytics data");
            } finally {
                setLoading(false);
            }
        };

        load();
    }, [isAllowed]);

    const handleLogout = () => {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
    };

    const max = Math.max(1, employmentInsights.employed, employmentInsights.unemployed, employmentInsights.self_employed);

    if (!isAllowed) {
        return (
            <div className="admin-employer-shell">
                <div className="admin-employer-center">
                    <div className="admin-employer-card">
                        <h3>Registrar Admin Access Only</h3>
                        <p>Please log in using a Registrar Admin account.</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <AdminShell
            scope="registrar"
            title="Analytics"
            subtitle="Employment insights based on alumni profile data."
            eyebrow="Registrar Console"
            onLogout={handleLogout}
        >
            {error ? <p className="notice error">{error}</p> : null}

            <section className="analytics-grid" style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
                <Card className="queue-panel h-100" style={{ borderRadius: 16 }}>
                    <Card.Body>
                        <h3 style={{ marginBottom: 12 }}>Employment Insights</h3>

                        {loading ? <Spinner animation="border" size="sm" /> : null}

                        {!loading ? (
                            <div style={{ display: "grid", gap: 12 }}>
                                {[
                                    { label: "Employed", value: employmentInsights.employed, color: "#1b6f52" },
                                    { label: "Unemployed", value: employmentInsights.unemployed, color: "#1f8a5f" },
                                    { label: "Self-Employed", value: employmentInsights.self_employed, color: "#9333ea" }
                                ].map((row) => {
                                    const pct = (row.value / max) * 100;
                                    return (
                                        <div key={row.label} style={{ display: "grid", gap: 6 }}>
                                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                                <span style={{ fontWeight: 700 }}>{row.label}</span>
                                                <span>{row.value}</span>
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
                        ) : null}
                    </Card.Body>
                </Card>

                <Card className="audit-panel h-100" style={{ borderRadius: 16 }}>
                    <Card.Body>
                        <h3 style={{ marginBottom: 12 }}>Chart</h3>
                        <p style={{ marginBottom: 8, opacity: 0.85 }}>Bar visualization (counts computed from <strong>AlumniProfile.employment_status</strong>).</p>

                        {loading ? <Spinner animation="border" size="sm" /> : null}
                        {!loading ? (
                            <div style={{ display: "grid", alignItems: "end", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, height: 220 }}>
                                {[
                                    { label: "Employed", value: employmentInsights.employed, color: "#1b6f52" },
                                    { label: "Unemployed", value: employmentInsights.unemployed, color: "#2f9e44" },
                                    { label: "Self-Employed", value: employmentInsights.self_employed, color: "#9333ea" }
                                ].map((b) => {
                                    const pct = (b.value / max) * 100;
                                    return (
                                        <div key={b.label} style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: 8 }}>
                                            <div style={{ height: `${pct}%`, background: b.color, borderRadius: 12, transition: "height 250ms ease" }} />
                                            <div style={{ fontSize: 12, textAlign: "center" }}>{b.label}</div>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : null}
                    </Card.Body>
                </Card>
            </section>
        </AdminShell>
    );
}

