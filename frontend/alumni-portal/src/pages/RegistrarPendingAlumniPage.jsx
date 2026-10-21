import { academicLabel } from "../utils/academicPrograms";
import React, { useEffect, useMemo, useState } from "react";
import { Button, Card, Form, Table } from "react-bootstrap";
import { Link, useNavigate } from "react-router-dom";
import AdminShell from "../components/AdminShell";
import useRenderDebug from "../hooks/useRenderDebug";
import { api } from "../services/api";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

function normalizeStatus(status) {
    if (status == null) return "";
    return String(status).trim().toLowerCase();
}

function getFullName(u) {
    return u?.full_name || u?.name || "";
}

export default function RegistrarPendingAlumniPage() {
    useRenderDebug("RegistrarPendingAlumniPage");
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
    const [allPending, setAllPending] = useState([]);

    const [query, setQuery] = useState("");
    const [pageSize, setPageSize] = useState(PAGE_SIZE_OPTIONS[0]);
    const [page, setPage] = useState(1);

    useEffect(() => {
        if (!isAllowed) return;

        const load = async () => {
            setLoading(true);
            setError("");
            try {
                // Source of pending users: existing registrar hook uses /users/pending.
                const data = await api.get("/users/pending", true);
                const items = Array.isArray(data) ? data : [];

                // Spec: status === pending. We infer "pending" based on available fields.
                // Accept a couple common variants from backend responses.
                const filtered = items.filter((item) => {
                    const s =
                        normalizeStatus(item?.status) ||
                        normalizeStatus(item?.account_status) ||
                        normalizeStatus(item?.accountStatus);
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
            const year = String(item?.AlumniProfile?.graduation_year ?? item?.graduation_year ?? "").toLowerCase();
            const course = academicLabel(item?.AlumniProfile?.course ?? item?.course, item?.AlumniProfile?.major ?? item?.major).toLowerCase();
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
            title="Pending Alumni"
            subtitle="View only alumni registrations that are pending."
            eyebrow="Registrar Console"
            onLogout={handleLogout}
        >
            {error ? <p className="notice error">{error}</p> : null}

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
                                        <td>
                                            {item?.AlumniProfile?.graduation_year ?? item?.graduation_year ?? "—"}
                                        </td>
                                        <td>{academicLabel(item?.AlumniProfile?.course ?? item?.course, item?.AlumniProfile?.major ?? item?.major)}</td>
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
        </AdminShell>
    );
}

