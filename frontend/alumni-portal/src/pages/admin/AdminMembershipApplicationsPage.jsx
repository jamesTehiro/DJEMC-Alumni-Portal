import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Spinner } from "react-bootstrap";
import { FiEye, FiFilter, FiSearch } from "react-icons/fi";
import AdminShell from "../../components/AdminShell";
import MembershipApplicationPreviewPanel from "../../components/membership/MembershipApplicationPreviewPanel";
import { api } from "../../services/api";
import { membershipSubmittedDate } from "../../utils/membershipDocument";
import { emptyMembershipFilters, isMembershipManagementUser, membershipManagementQuery, membershipRowNumber, validateMembershipListResponse } from "../../utils/membershipManagement";
import { clearSessionAndGoHome, getStoredUser } from "./adminUtils";
import "../AdminEmployerPage.css";
import "./MembershipManagement.css";

export default function AdminMembershipApplicationsPage() {
    const scope = "alumni";
    const navigate = useNavigate();
    const user = useMemo(() => getStoredUser(), []);
    const allowedRole = isMembershipManagementUser(user);
    const [access, setAccess] = useState(null);
    const [accessError, setAccessError] = useState("");
    const [accessAttempt, setAccessAttempt] = useState(0);
    const [filters, setFilters] = useState(emptyMembershipFilters);
    const [query, setQuery] = useState(emptyMembershipFilters);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [applications, setApplications] = useState([]);
    const [total, setTotal] = useState(0);
    const [years, setYears] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [retry, setRetry] = useState(0);
    const [previewId, setPreviewId] = useState(null);

    useEffect(() => {
        if (!allowedRole) return;
        let active = true;
        api.get("/membership/access", true).then(response => {
            if (typeof response?.can_view !== "boolean") throw new Error("Membership viewing permission could not be verified.");
            if (active) { setAccess(response.scope === "alumni" && response.can_view); setAccessError(""); }
        }).catch(failure => { if (active) setAccessError(failure.message); });
        return () => { active = false; };
    }, [allowedRole, accessAttempt, scope]);
    useEffect(() => {
        const timer = window.setTimeout(() => { setQuery(filters); setPage(1); }, 300);
        return () => window.clearTimeout(timer);
    }, [filters]);
    useEffect(() => {
        if (access !== true) return;
        let active = true;
        async function load() {
            setLoading(true); setError("");
            try {
                const response = validateMembershipListResponse(await api.get("/membership/admin?" + membershipManagementQuery(query, page, pageSize), true));
                if (!active) return;
                setApplications(response.applications); setTotal(response.total);
                setYears(response.filter_options.graduation_years);
                const lastPage = Math.max(1, Math.ceil(response.total / pageSize));
                if (page > lastPage) setPage(lastPage);
            } catch (failure) {
                if (active) { setError(failure.message); setApplications([]); }
            } finally { if (active) setLoading(false); }
        }
        load();
        return () => { active = false; };
    }, [access, query, page, pageSize, retry]);

    const changeFilter = (key, value) => setFilters(previous => ({ ...previous, [key]: value }));
    const clearFilters = () => { const cleared = emptyMembershipFilters(); setFilters(cleared); setQuery(cleared); setPage(1); };
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const first = total ? (page - 1) * pageSize + 1 : 0;
    const last = Math.min(total, page * pageSize);
    if (!allowedRole) return <div className="admin-membership-access"><h1>Membership viewing permission required</h1><p>Sign in with an authorized Admin Alumni account.</p><Link to="/admin/login">Go to Login</Link></div>;
    return <AdminShell scope={scope} title="Membership Applications" subtitle="View and manage alumni association membership applications." eyebrow="Alumni Association" onLogout={() => clearSessionAndGoHome(navigate)}>
        <div className="membership-management">
            <nav className="membership-management-breadcrumb" aria-label="Breadcrumb"><Link to="/">Home</Link><span aria-hidden="true">→</span><Link to="/admin/alumni">Admin Alumni</Link><span aria-hidden="true">→</span><span aria-current="page">Membership Applications</span></nav>
            {accessError ? <div className="notice error" role="alert">{accessError} <button className="outline-btn" type="button" onClick={() => { setAccessError(""); setAccess(null); setAccessAttempt(value => value + 1); }}>Retry</button></div>
                : access === null ? <p role="status"><Spinner animation="border" size="sm" /> Checking access…</p>
                : access === false ? <section className="queue-panel"><h2>Access restricted</h2><p>Your account does not have permission to view membership applications.</p></section>
                : <>
                    <div className={"membership-management-workspace" + (previewId ? " with-preview" : "")}>
                        <section className="queue-panel membership-management-list">
                            <div className="membership-list-heading"><h2>Submitted Applications</h2>{!loading && !error && <span>{total} matching applications</span>}</div>
                            <div className="membership-management-filters">
                                <label className="membership-search"><span className="visually-hidden">Search alumni by name or email</span><FiSearch aria-hidden="true" /><input type="search" placeholder="Search alumni by name or email..." value={filters.search} onChange={event => changeFilter("search", event.target.value)} /></label>
                                <label><span>Graduation Year</span><select value={filters.graduation_year} onChange={event => changeFilter("graduation_year", event.target.value)}><option value="">All years</option>{years.map(year => <option key={year} value={year}>{year}</option>)}</select></label>
                                <label><span>Date Submitted</span><input type="date" value={filters.submitted_date} onChange={event => changeFilter("submitted_date", event.target.value)} /></label>
                                <button type="button" className="outline-btn membership-clear-filters" onClick={clearFilters}><FiFilter aria-hidden="true" /> Clear Filters</button>
                            </div>
                            <p className="membership-list-note">Newest submissions first. Filters apply to this list.</p>
                            {loading ? <p className="membership-management-loading" role="status"><Spinner animation="border" size="sm" /> Loading membership applications…</p>
                                : error ? <div className="notice error" role="alert">{error} <button className="outline-btn" type="button" onClick={() => setRetry(value => value + 1)}>Retry</button></div>
                                : <>
                                    <div className="membership-management-table-scroll"><table className="membership-management-table">
                                        <thead><tr><th scope="col">#</th><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Graduation Year</th><th scope="col">Date Submitted</th><th scope="col">Actions</th></tr></thead>
                                        <tbody>{applications.length ? applications.map((application, index) => {
                                            return <tr key={application.id} className={previewId === application.id ? "selected" : ""}>
                                                <td>{membershipRowNumber(page, pageSize, index)}</td><td className="membership-list-name">{application.name || "Name not recorded"}</td><td>{application.email || "Not recorded"}</td><td>{application.graduation_year || "Not recorded"}</td><td>{membershipSubmittedDate(application.submitted_at)}</td>
                                                <td><button className="outline-btn membership-view-button" type="button" onClick={() => setPreviewId(application.id)}><FiEye aria-hidden="true" /> View<span className="visually-hidden"> application for {application.name || "this applicant"}</span></button></td>
                                            </tr>;
                                        }) : <tr><td className="membership-list-empty" colSpan={6}>{Object.values(query).some(Boolean) ? "No submitted applications match these filters." : "No membership applications have been submitted yet."}</td></tr>}</tbody>
                                    </table></div>
                                    <div className="membership-management-pagination"><span>Showing {first}–{last} of {total}</span><label>Rows per page <select value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(1); }}>{[10, 25, 50, 100].map(size => <option key={size} value={size}>{size}</option>)}</select></label><div><button className="outline-btn" type="button" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>Previous</button><span>Page {page} of {pages}</span><button className="outline-btn" type="button" disabled={page >= pages} onClick={() => setPage(value => value + 1)}>Next</button></div></div>
                                </>}
                        </section>
                        {previewId && <MembershipApplicationPreviewPanel key={previewId} applicationId={previewId} onClose={() => setPreviewId(null)} />}
                    </div>
                </>}
        </div>
    </AdminShell>;
}
