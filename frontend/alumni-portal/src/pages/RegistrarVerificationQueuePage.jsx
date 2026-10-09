import React, { useMemo, useState } from "react";
import { Alert, Badge, Button, Card, Col, Modal, Row, Table } from "react-bootstrap";
import { Link, useNavigate } from "react-router-dom";
import AdminShell from "../components/AdminShell";
import AlumniSearchBar from "../components/AlumniSearchBar";
import AlumniRecordsTable from "../components/AlumniRecordsTable";
import useRenderDebug from "../hooks/useRenderDebug";
import useRegistrarAdminData from "./registrar/useRegistrarAdminData";
import "./AdminEmployerPage.css";

export default function RegistrarVerificationQueuePage() {
    useRenderDebug("RegistrarVerificationQueuePage");
    const navigate = useNavigate();
    const [showProofModal, setShowProofModal] = useState(false);
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

    const selectedProof = selectedUser?.AlumniProfile?.proof_document_url || null;
    const selectedProofName = selectedUser?.AlumniProfile?.proof_document_name || "Proof of Graduation";
    const selectedProofType = useMemo(() => {
        const lower = String(selectedProofName || "").toLowerCase();
        if (lower.endsWith(".pdf")) return "pdf";
        if (/\.(png|jpe?g|webp|gif|bmp)$/i.test(lower)) return "image";
        return "generic";
    }, [selectedProofName]);

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

            <Row className="g-4">
                <Col lg={8}>
                    <Card className="queue-panel h-100">
                        <Card.Body>
                            <div className="panel-header">
                                <h2>Search Alumni Records</h2>
                            </div>
                            <AlumniSearchBar
                                value={searchTerm}
                                onChange={handleSearchChange}
                                disabled={false}
                            />
                            <div className="mt-3">
                                {selectedRecord ? (
                                    <Alert variant="success" className="mb-3">
                                        Record Found: {selectedRecord.course} - Batch {selectedRecord.batch_year}
                                    </Alert>
                                ) : null}
                                <div className="search-result-list">
                                    {searchResults.map((record) => (
                                        <button
                                            type="button"
                                            key={record.id}
                                            className={`search-result-item${selectedRecord?.id === record.id ? " active" : ""}`}
                                            onClick={() => setSelectedRecord(record)}
                                        >
                                            <strong>{record.full_name}</strong>
                                            <span>{record.course} • Batch {record.batch_year}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </Card.Body>
                    </Card>
                </Col>

                <Col lg={4}>
                    <Card className="audit-panel h-100">
                        <Card.Body>
                            <h3>Selected Pending User</h3>
                            {!selectedUser && <p className="empty">Select a pending alumni user to start verification.</p>}
                            {selectedUser && (
                                <div className="form-stack">
                                    <div><strong>Full Name:</strong> {selectedUser.name}</div>
                                    <div><strong>Email:</strong> {selectedUser.email}</div>
                                    <div>
                                        <strong>Submitted Info:</strong>{" "}
                                        {selectedUser.AlumniProfile?.course || "N/A"}
                                        {selectedUser.AlumniProfile?.graduation_year ? ` • Batch ${selectedUser.AlumniProfile.graduation_year}` : ""}
                                    </div>
                                    <div>
                                        <strong>Status:</strong>{" "}
                                        <Badge bg={statusVariant(selectedUser.account_status)}>
                                            {selectedUser.account_status === "verified" ? "Approved" : selectedUser.account_status}
                                        </Badge>
                                    </div>
                                    <div>
                                        <strong>Proof of Graduation</strong>
                                        {selectedUser.AlumniProfile?.proof_document_url ? (
                                            <div className="mt-2">
                                                <div className="text-success">✓ Document submitted</div>
                                                <Button variant="outline-primary" size="sm" onClick={() => setShowProofModal(true)}>
                                                    View Document
                                                </Button>
                                            </div>
                                        ) : (
                                            <div className="mt-2 text-danger">✕ No document submitted</div>
                                        )}
                                    </div>
                                    <Button variant="success" disabled={!selectedRecord} onClick={handleApprove}>
                                        Approve
                                    </Button>
                                    <Button variant="outline-danger" onClick={() => handleReject(selectedUser.id)}>
                                        Reject
                                    </Button>
                                </div>
                            )}
                        </Card.Body>
                    </Card>
                </Col>
            </Row>

            <Modal show={showProofModal} onHide={() => setShowProofModal(false)} centered size="lg">
                <Modal.Header closeButton>
                    <Modal.Title>Proof of Graduation</Modal.Title>
                </Modal.Header>
                <Modal.Body className="text-center">
                    {selectedProof ? (
                        selectedProofType === "pdf" ? (
                            <iframe
                                title={selectedProofName}
                                src={selectedProof}
                                style={{ width: "100%", minHeight: "70vh", border: "none" }}
                            />
                        ) : selectedProofType === "image" ? (
                            <img
                                src={selectedProof}
                                alt={selectedProofName}
                                style={{ maxWidth: "100%", maxHeight: "70vh", objectFit: "contain" }}
                            />
                        ) : (
                            <div>
                                <p>Unable to preview this file inline.</p>
                                <a href={selectedProof} target="_blank" rel="noreferrer">Open document</a>
                            </div>
                        )
                    ) : (
                        <p>No document available.</p>
                    )}
                </Modal.Body>
            </Modal>

            <Row className="g-4 mt-1">
                <Col lg={7}>
                    <Card className="queue-panel">
                        <Card.Body>
                            <div className="panel-header">
                                <h2>Pending Users List</h2>
                                <span>{pendingUsers.length} Pending</span>
                            </div>
                            <Table responsive hover className="mb-0">
                                <thead>
                                    <tr>
                                        <th>Full Name</th>
                                        <th>Email</th>
                                        <th>Submitted Info</th>
                                        <th>Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {pendingUsers.length === 0 && (
                                        <tr><td colSpan={4} className="text-center text-muted">No pending users.</td></tr>
                                    )}
                                    {pendingUsers.map((item) => (
                                        <tr
                                            key={item.id}
                                            className={selectedUser?.id === item.id ? "selected-row" : ""}
                                            onClick={() => setSelectedUser(item)}
                                            style={{ cursor: "pointer" }}
                                        >
                                            <td>{item.name}</td>
                                            <td>{item.email}</td>
                                            <td>
                                                {item.AlumniProfile?.course || "N/A"}
                                                {item.AlumniProfile?.graduation_year ? ` • Batch ${item.AlumniProfile.graduation_year}` : ""}
                                            </td>
                                            <td><Badge bg={statusVariant(item.account_status)}>{item.account_status}</Badge></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </Table>
                        </Card.Body>
                    </Card>
                </Col>

                <Col lg={5}>
                    <Card className="audit-panel">
                        <Card.Body>
                            <h3>Master Alumni List</h3>
                            <AlumniRecordsTable records={records} selectedRecordId={selectedRecord?.id} />
                        </Card.Body>
                    </Card>
                </Col>
            </Row>

        </AdminShell>
    );
}
