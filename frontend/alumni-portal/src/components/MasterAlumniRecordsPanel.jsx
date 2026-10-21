import React, { useMemo, useState } from "react";
import { FaUsers, FaGraduationCap, FaCalendarAlt, FaFileAlt, FaUserCircle } from "react-icons/fa";
import { FiSearch, FiFilter, FiChevronLeft, FiChevronRight, FiTrash2, FiArrowUp, FiArrowDown, FiEdit2 } from "react-icons/fi";
import { programLabel, programKey } from "../utils/academicPrograms";
import DeleteConfirmationModal from "./DeleteConfirmationModal";
import "./MasterAlumniRecordsPanel.css";

const nameOf = (record) => record.full_name || record.name || "";
const batchOf = (record) => record.batch_year ?? record.batch ?? "";
const dateOf = (record) => {
    const date = new Date(record.createdAt);
    return record.createdAt && !Number.isNaN(date.getTime()) ? date : null;
};

export default function MasterAlumniRecordsPanel({ records = [], loading = false, actions, selectedRecordId, onSelectRecord, onEditRecord, onDeleteRecord, deletingRecordId, detailColumns = [] }) {
    const [query, setQuery] = useState("");
    const [program, setProgram] = useState("");
    const [major, setMajor] = useState("");
    const [batch, setBatch] = useState("");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [sort, setSort] = useState({ key: "name", ascending: true });
    const [deleteTarget, setDeleteTarget] = useState(null);
    const programs = useMemo(() => [...new Set(records.map((record) => programKey(record.course)).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [records]);
    const majors = useMemo(() => [...new Set(records.filter(record => !program || programKey(record.course) === program).map(record => record.major).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [records, program]);
    const batches = useMemo(() => [...new Set(records.map(batchOf).filter((value) => String(value).trim()))].sort((a, b) => Number(b) - Number(a)), [records]);
    const recent = records.filter((record) => {
        const added = dateOf(record)?.getTime();
        return added && added <= Date.now() && added >= Date.now() - 30 * 24 * 60 * 60 * 1000;
    }).length;
    const filtered = useMemo(() => {
        const search = query.trim().toLowerCase();
        return records.filter((record) => (!program || programKey(record.course) === program) && (!major || record.major === major) && (!batch || String(batchOf(record)) === batch)
            && (!search || [nameOf(record), programLabel(record.course), record.major, batchOf(record), record.User?.AlumniProfile?.address].some((value) => String(value || "").toLowerCase().includes(search))))
            .sort((a, b) => {
                const value = (record) => sort.key === "name" ? nameOf(record) : sort.key === "course" ? record.course || "" : sort.key === "batch" ? batchOf(record) : dateOf(record)?.getTime() || "";
                const left = value(a), right = value(b);
                if (left === "") return right === "" ? Number(a.id) - Number(b.id) : 1;
                if (right === "") return -1;
                const difference = sort.key === "batch" || sort.key === "date" ? Number(left) - Number(right) : String(left).localeCompare(String(right), undefined, { sensitivity: "base" });
                return difference * (sort.ascending ? 1 : -1) || Number(a.id) - Number(b.id);
            });
    }, [records, query, program, major, batch, sort]);
    const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
    const currentPage = Math.min(page, pageCount);
    const start = (currentPage - 1) * pageSize;
    const visible = filtered.slice(start, start + pageSize);
    const pageNumbers = [...new Set([1, ...Array.from({ length: 5 }, (_, index) => currentPage - 2 + index).filter((value) => value > 1 && value < pageCount), pageCount])];
    const changeFilter = (setter, value) => { setter(value); setPage(1); };
    const sortHeading = (key, label) => <button type="button" onClick={() => { setSort({ key, ascending: sort.key !== key || !sort.ascending }); setPage(1); }}>{label}{sort.key === key ? sort.ascending ? <FiArrowUp /> : <FiArrowDown /> : <span aria-hidden="true">↕</span>}</button>;

    return <div className="master-alumni-records">
        {actions && <div className="master-records-toolbar">{actions}</div>}
        <section className="master-records-metrics mobile-scroll-cards" aria-label="Master records summary">
            {[
                { label: "Total Alumni Records", count: records.length, icon: <FaUsers />, tone: "green" },
                { label: "Academic Programs", count: programs.length, icon: <FaGraduationCap />, tone: "amber" },
                { label: "Graduation Batches", count: batches.length, icon: <FaCalendarAlt />, tone: "green" },
                { label: "Recently Added", count: recent, icon: <FaFileAlt />, tone: "blue", note: "in the last 30 days" }
            ].map((metric) => <article key={metric.label} className={`master-records-metric ${metric.tone}`}><span className="master-records-metric-icon" aria-hidden="true">{metric.icon}</span><div><span>{metric.label}</span><strong>{loading ? "—" : metric.count.toLocaleString()}</strong>{metric.note && <small>{metric.note}</small>}</div></article>)}
        </section>
        <section className="master-records-card">
            <header><h2>Official Master List</h2><span>{loading ? "Loading records…" : `Showing ${filtered.length ? start + 1 : 0} – ${Math.min(start + pageSize, filtered.length)} of ${filtered.length.toLocaleString()} records`}</span></header>
            <div className="master-records-filters">
                <label className="master-records-search"><FiSearch aria-hidden="true" /><input type="search" aria-label="Search alumni records" placeholder="Search alumni by name…" value={query} onChange={(event) => changeFilter(setQuery, event.target.value)} /></label>
                <select aria-label="Filter by academic program" value={program} onChange={(event) => { changeFilter(setProgram, event.target.value); setMajor(""); }}><option value="">All Programs</option>{programs.map((value) => <option key={value} value={value}>{programLabel(value)}</option>)}</select>
                <select aria-label="Filter by major" value={major} onChange={event => changeFilter(setMajor, event.target.value)}><option value="">All Majors / Specializations</option>{majors.map(value => <option key={value} value={value}>{value}</option>)}</select>
                <select aria-label="Filter by graduation batch" value={batch} onChange={(event) => changeFilter(setBatch, event.target.value)}><option value="">All Graduation Batches</option>{batches.map((value) => <option key={value} value={value}>{value}</option>)}</select>
                <button type="button" className="master-records-clear" onClick={() => { setQuery(""); setProgram(""); setMajor(""); setBatch(""); setPage(1); }}><FiFilter aria-hidden="true" />Clear Filters</button>
            </div>
            <div className="master-records-table-scroll"><table>
                <thead><tr><th>#</th><th aria-sort={sort.key === "name" ? sort.ascending ? "ascending" : "descending" : "none"}>{sortHeading("name", "Full Name")}</th><th aria-sort={sort.key === "course" ? sort.ascending ? "ascending" : "descending" : "none"}>{sortHeading("course", "Program")}</th><th>Major / Specialization</th><th aria-sort={sort.key === "batch" ? sort.ascending ? "ascending" : "descending" : "none"}>{sortHeading("batch", "Year Graduated")}</th><th>Record Status</th><th aria-sort={sort.key === "date" ? sort.ascending ? "ascending" : "descending" : "none"}>{sortHeading("date", "Date Added")}</th>{detailColumns.map((column) => <th key={column.label}>{column.label}</th>)}{(onDeleteRecord || onEditRecord) && <th>Actions</th>}</tr></thead>
                <tbody>{loading || !visible.length ? <tr><td colSpan={7 + detailColumns.length + (onDeleteRecord || onEditRecord ? 1 : 0)} className="master-records-empty">{loading ? "Loading alumni records…" : "No alumni records match your filters."}</td></tr> : visible.map((record, index) => <tr key={record.id} className={selectedRecordId === record.id ? "is-selected" : ""}>
                    <td>{start + index + 1}</td><td><div className="master-records-name"><FaUserCircle aria-hidden="true" />{onSelectRecord ? <button type="button" onClick={() => onSelectRecord(record)}>{nameOf(record) || "Name not recorded"}</button> : <span>{nameOf(record) || "Name not recorded"}</span>}</div></td><td>{programLabel(record.course)}</td><td>{record.major || "Not recorded"}</td><td>{batchOf(record) || "—"}</td><td><span className="master-records-status">Official Record</span></td><td>{dateOf(record)?.toLocaleDateString(undefined, { month: "short", day: "2-digit", year: "numeric" }) || "Not recorded"}</td>{detailColumns.map((column) => <td key={column.label}>{column.render(record)}</td>)}{(onDeleteRecord || onEditRecord) && <td>{onEditRecord && <button type="button" className="master-records-clear" aria-label={`Edit ${nameOf(record) || "record"}`} onClick={() => onEditRecord(record)}><FiEdit2 aria-hidden="true" /></button>}{onDeleteRecord && <button type="button" className="master-records-delete" title="Delete record" aria-label={`Delete ${nameOf(record) || "record"}`} onClick={() => setDeleteTarget(record)} disabled={deletingRecordId === record.id}><FiTrash2 aria-hidden="true" /></button>}</td>}
                </tr>)}</tbody>
            </table></div>
            <footer className="master-records-pagination"><label>Rows per page:<select aria-label="Rows per page" value={pageSize} onChange={(event) => changeFilter(setPageSize, Number(event.target.value))}>{[10, 20, 25, 50].map((size) => <option key={size} value={size}>{size}</option>)}</select></label><nav aria-label="Record pagination"><button type="button" aria-label="Previous page" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}><FiChevronLeft /></button>{pageNumbers.map((number, index) => <React.Fragment key={number}>{index > 0 && number - pageNumbers[index - 1] > 1 && <span>…</span>}<button type="button" className={number === currentPage ? "active" : ""} aria-current={number === currentPage ? "page" : undefined} onClick={() => setPage(number)}>{number}</button></React.Fragment>)}<button type="button" aria-label="Next page" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}><FiChevronRight /></button></nav></footer>
        </section>
        <DeleteConfirmationModal show={!!deleteTarget} record={deleteTarget} onHide={() => setDeleteTarget(null)} onConfirm={() => { onDeleteRecord(deleteTarget); setDeleteTarget(null); }} loading={deleteTarget && deletingRecordId === deleteTarget.id} />
    </div>;
}
