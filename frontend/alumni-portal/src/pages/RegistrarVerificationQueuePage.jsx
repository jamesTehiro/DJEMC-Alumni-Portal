import { academicLabel } from "../utils/academicPrograms";
import React, { useRef, useState } from "react";
import { Alert, Badge, Button, Modal } from "react-bootstrap";
import { FiSearch, FiEye, FiCheck, FiUser, FiChevronLeft, FiChevronRight, FiDownload, FiFile } from "react-icons/fi";
import { FaUserCircle } from "react-icons/fa";
import { Link, useNavigate } from "react-router-dom";
import AdminShell from "../components/AdminShell";
import AlumniSearchBar from "../components/AlumniSearchBar";
import AlumniRecordsTable from "../components/AlumniRecordsTable";
import useRenderDebug from "../hooks/useRenderDebug";
import useRegistrarAdminData from "./registrar/useRegistrarAdminData";
import "./AdminEmployerPage.css";
import "./RegistrarVerificationQueuePage.css";
import GraduationProofPreview from "../components/GraduationProofPreview";
import { fetchFile } from "../services/api";

const fileTypeLabel = document => {
    const extension = String(document?.name || "").split(".").pop();
    if (extension && extension !== document?.name) return extension.toUpperCase();
    const mime = String(document?.mime_type || "").toLowerCase();
    if (mime === "application/pdf") return "PDF";
    if (mime.startsWith("image/")) return "IMAGE";
    if (mime.includes("wordprocessingml")) return "DOCX";
    if (mime === "application/msword") return "DOC";
    return "FILE";
};

export default function RegistrarVerificationQueuePage() {
    useRenderDebug("RegistrarVerificationQueuePage");
    const navigate = useNavigate();
    const [showProofModal, setShowProofModal] = useState(false);
    const [proofIndex, setProofIndex] = useState(0);
    const [proofDownloadError, setProofDownloadError] = useState("");
    const [downloadingProof, setDownloadingProof] = useState(-1);
    const [pendingQuery, setPendingQuery] = useState("");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [reviewBusy, setReviewBusy] = useState(false);
    const reviewInProgress = useRef(false);
    const selectedPanelRef = useRef(null);
    const {
        isAllowed,
        pendingUsers,
        records,
        searchTerm,
        searchResults,
        selectedUser,
        selectedRecord,
        message,
        error,
        setSelectedUser,
        setSelectedRecord,
        handleApprove,
        handleReject,
        handleSearchChange,
        statusVariant
    } = useRegistrarAdminData();

    const handleLogout = () => {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        navigate("/");
    };

    const alumniProfile = selectedUser?.AlumniProfile || {};
    const proofDocuments = (() => {
        const listed = Array.isArray(alumniProfile.proof_documents) ? alumniProfile.proof_documents : [];
        const documents = listed.filter(document => document?.url);
        if (alumniProfile.proof_document_url && !documents.some(document => document.url === alumniProfile.proof_document_url)) {
            documents.unshift({ url: alumniProfile.proof_document_url, name: alumniProfile.proof_document_name || "Proof of Graduation" });
        }
        return documents;
    })();
    const selectedProof = proofDocuments[proofIndex]?.url || null;
    const filteredPendingUsers = pendingUsers.filter((item) => [item.name, item.email, academicLabel(item.AlumniProfile?.course, item.AlumniProfile?.major, item.AlumniProfile?.graduation_year)].some((value) => String(value || "").toLowerCase().includes(pendingQuery.trim().toLowerCase())));
    const pageCount = Math.max(1, Math.ceil(filteredPendingUsers.length / pageSize));
    const currentPage = Math.min(page, pageCount);
    const start = (currentPage - 1) * pageSize;
    const visiblePendingUsers = filteredPendingUsers.slice(start, start + pageSize);
    const selectPendingUser = (item, startVerification = false) => {
        if (reviewInProgress.current) return;
        setShowProofModal(false);
        setProofIndex(0);
        if (selectedUser?.id !== item.id) {
            setSelectedRecord(null);
            setSelectedUser(item);
        }
        if (startVerification) selectedPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    };
    const reviewUser = async (action) => {
        if (!selectedUser || reviewInProgress.current) return;
        reviewInProgress.current = true;
        setReviewBusy(true);
        try { await action(); }
        finally { reviewInProgress.current = false; setReviewBusy(false); }
    };
    const selectedProofName = proofDocuments[proofIndex]?.name || "Proof of Graduation";
    const downloadProof = async (document, index) => {
        setProofDownloadError("");
        setDownloadingProof(index);
        let objectUrl;
        try {
            const blob = await fetchFile(document.url, true);
            objectUrl = URL.createObjectURL(blob);
            const link = window.document.createElement("a");
            link.href = objectUrl;
            link.download = document.name || `proof-document-${index + 1}`;
            window.document.body.appendChild(link);
            link.click();
            link.remove();
        } catch (failure) {
            setProofDownloadError(failure.message || "This document could not be downloaded. Please try again.");
        } finally {
            if (objectUrl) window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
            setDownloadingProof(-1);
        }
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
            title="Verification Queue"
            subtitle="Review pending alumni registrations against the master alumni records."
            eyebrow="Registrar Console"
            onLogout={handleLogout}
        >
            {message && <p className="notice success">{message}</p>}
            {error && <p className="notice error">{error}</p>}

            <section className="registrar-verification-queue">
                <section className="rvq-panel rvq-pending-panel" aria-labelledby="rvq-pending-title">
                    <header className="rvq-panel-header"><h2 id="rvq-pending-title">Pending Users</h2><p>Review and verify alumni registrations.</p></header>
                    <label className="rvq-search-label"><FiSearch aria-hidden="true" /><input type="search" aria-label="Search pending users by name or email" placeholder="Search name or email?" value={pendingQuery} onChange={(event) => { setPendingQuery(event.target.value); setPage(1); }} /></label>
                    <div className="rvq-table-scroll"><table>
                        <thead><tr><th>#</th><th>Full Name</th><th>Email</th><th>Submitted Info</th><th>Date Submitted</th><th>Status</th><th>Actions</th></tr></thead>
                        <tbody>{visiblePendingUsers.length === 0 ? <tr><td colSpan="7" className="rvq-table-empty">{pendingQuery ? "No pending users match your search." : "No pending alumni registrations."}</td></tr> : visiblePendingUsers.map((item, index) => {
                            const submitted = item.createdAt ? new Date(item.createdAt) : null;
                            const validDate = submitted && !Number.isNaN(submitted.getTime());
                            return <tr key={item.id} className={selectedUser?.id === item.id ? "selected" : ""} onClick={() => selectPendingUser(item)}>
                                <td>{start + index + 1}</td>
                                <td><div className="rvq-name-cell"><FaUserCircle className="avatar-icon" aria-hidden="true" /><span>{item.name || "Name not provided"}</span></div></td>
                                <td>{item.email || "Not provided"}</td>
                                <td>{academicLabel(item.AlumniProfile?.course, item.AlumniProfile?.major, item.AlumniProfile?.graduation_year)}</td>
                                <td>{validDate ? <><span>{submitted.toLocaleDateString(undefined, { month: "short", day: "2-digit", year: "numeric" })}</span><small>{submitted.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small></> : "Not recorded"}</td>
                                <td><span className="rvq-status">{item.account_status ? item.account_status.charAt(0).toUpperCase() + item.account_status.slice(1) : "Pending"}</span></td>
                                <td><div className="rvq-row-actions"><button type="button" className="rvq-action-button" title="View user details" aria-label={'View details for ' + (item.name || "pending user")} disabled={reviewBusy} onClick={(event) => { event.stopPropagation(); selectPendingUser(item, true); }}><FiEye aria-hidden="true" /></button><button type="button" className="rvq-action-button" title="Start verification" aria-label={'Start verification for ' + (item.name || "pending user")} disabled={reviewBusy} onClick={(event) => { event.stopPropagation(); selectPendingUser(item, true); }}><FiCheck aria-hidden="true" /></button></div></td>
                            </tr>;
                        })}</tbody>
                    </table></div>
                    <footer className="rvq-pagination"><span>Showing {filteredPendingUsers.length ? start + 1 : 0} to {Math.min(start + pageSize, filteredPendingUsers.length)} of {filteredPendingUsers.length} pending users</span><div className="rvq-pagination-controls"><label>Rows per page:<select aria-label="Pending users per page" value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}>{[10, 20, 50].map((size) => <option key={size} value={size}>{size}</option>)}</select></label><nav aria-label="Pending users pagination"><button type="button" aria-label="Previous page" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}><FiChevronLeft /></button><span aria-current="page">{currentPage}</span><button type="button" aria-label="Next page" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}><FiChevronRight /></button></nav></div></footer>
                </section>
                <aside className="rvq-panel rvq-selected-panel" ref={selectedPanelRef} aria-labelledby="rvq-selected-title">
                    <header className="rvq-panel-header"><h2 id="rvq-selected-title">Selected Pending User</h2></header>
                    {!selectedUser ? <div className="rvq-empty-user"><div className="rvq-empty-avatar"><FiUser aria-hidden="true" /></div><div><h3>No user selected</h3><p>Select a pending alumni user from the list to view their details and start verification.</p></div></div> : <>
                        <div className="rvq-user-summary"><FaUserCircle className="rvq-user-avatar" aria-hidden="true" /><div><h3>{selectedUser.name || "Pending user"}</h3><p>{selectedUser.email || "Email not provided"}</p></div></div>
                        <dl className="rvq-user-details"><dt>Submitted Info</dt><dd>{academicLabel(selectedUser.AlumniProfile?.course, selectedUser.AlumniProfile?.major, selectedUser.AlumniProfile?.graduation_year)}</dd><dt>Status</dt><dd><Badge bg={statusVariant(selectedUser.account_status)}>{selectedUser.account_status === "verified" ? "Approved" : selectedUser.account_status}</Badge></dd><dt>Proof of Graduation</dt><dd>{proofDocuments.length > 0 ? <><p className="text-success">{proofDocuments.length} document{proofDocuments.length === 1 ? "" : "s"} submitted</p><Button variant="outline-success" size="sm" onClick={() => { setProofIndex(0); setProofDownloadError(""); setShowProofModal(true); }}>View Document{proofDocuments.length > 1 ? "s" : ""}</Button></> : <span className="text-danger">No document submitted</span>}</dd></dl>
                        <section className="rvq-record-match"><h3>Match an Official Record</h3><p>Search the master list and select the record used for verification.</p><AlumniSearchBar value={searchTerm} onChange={handleSearchChange} disabled={reviewBusy} />
                            {selectedRecord && <Alert variant="success" className="mt-3 mb-2"><strong>{selectedRecord.full_name}</strong><br />{academicLabel(selectedRecord.course, selectedRecord.major, selectedRecord.batch_year)}</Alert>}
                            <div className="search-result-list">{searchResults.map((record) => <button type="button" key={record.id} disabled={reviewBusy} className={'search-result-item' + (selectedRecord?.id === record.id ? " active" : "")} onClick={() => setSelectedRecord(record)}><strong>{record.full_name}</strong><span>{academicLabel(record.course, record.major, record.batch_year)}</span></button>)}</div>
                            {searchTerm.trim() && searchResults.length === 0 && <p className="rvq-match-empty">No matching records found. Try another name.</p>}
                            <details className="rvq-master-list"><summary>Browse Master Alumni List</summary><AlumniRecordsTable records={records} selectedRecordId={selectedRecord?.id} /></details>
                        </section>
                        <div className="rvq-review-actions"><Button variant="success" disabled={!selectedRecord || reviewBusy} onClick={() => reviewUser(handleApprove)}>{reviewBusy ? "Processing?" : "Approve"}</Button><Button variant="outline-danger" disabled={reviewBusy} onClick={() => reviewUser(() => handleReject(selectedUser.id))}>Reject</Button></div>
                    </>}
                </aside>
            </section>

            <Modal show={showProofModal} onHide={() => setShowProofModal(false)} centered size="xl" dialogClassName="rvq-proof-modal">
                <Modal.Header closeButton>
                    <Modal.Title>Proof of Graduation</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <div className="rvq-proof-viewer">
                        <section className="rvq-proof-list" aria-label="Submitted proof documents">
                            <h3>Submitted documents <span>{proofDocuments.length}</span></h3>
                            {proofDocuments.length === 0 ? <p className="rvq-proof-empty">No document is available for this registration.</p> : <ul>
                                {proofDocuments.map((document, index) => <li key={`${document.url}-${index}`} className={index === proofIndex ? "active" : ""}>
                                    <div className="rvq-proof-file-icon" aria-hidden="true"><FiFile /></div>
                                    <div className="rvq-proof-file-details">
                                        <strong title={document.name || "Proof of Graduation"}>{document.name || "Proof of Graduation"}</strong>
                                        <span>{fileTypeLabel(document)}</span>
                                    </div>
                                    <div className="rvq-proof-file-actions">
                                        <Button type="button" variant="outline-success" size="sm" aria-label={`Preview ${document.name || `document ${index + 1}`}`} aria-pressed={index === proofIndex} onClick={() => { setProofIndex(index); setProofDownloadError(""); }}>Preview</Button>
                                        <Button type="button" variant="light" size="sm" disabled={downloadingProof === index} aria-label={`Download ${document.name || `document ${index + 1}`}`} onClick={() => downloadProof(document, index)}>
                                            <FiDownload aria-hidden="true" />{downloadingProof === index ? "Downloading" : "Download"}
                                        </Button>
                                    </div>
                                </li>)}
                            </ul>}
                        </section>
                        <section className="rvq-proof-preview" aria-label="Selected document preview">
                            {proofDownloadError && <Alert variant="danger" role="alert">{proofDownloadError}</Alert>}
                            {showProofModal && selectedProof ? <GraduationProofPreview key={selectedProof} path={selectedProof} name={selectedProofName} /> : <p className="rvq-proof-empty">Select a document to preview it.</p>}
                        </section>
                    </div>
                </Modal.Body>
            </Modal>

        </AdminShell>
    );
}
