import React, { useState } from "react";
import { Alert, Button, Card, Col, Row, Toast } from "react-bootstrap";
import { Link, useNavigate } from "react-router-dom";
import AdminShell from "../components/AdminShell";
import AlumniSearchBar from "../components/AlumniSearchBar";
import AlumniRecordsTable from "../components/AlumniRecordsTable";
import AddAlumniModal from "../components/AddAlumniModal";
import useRenderDebug from "../hooks/useRenderDebug";
import useRegistrarAdminData from "./registrar/useRegistrarAdminData";
import { api } from "../services/api";
import { useUndoDelete } from "../hooks/useUndoDelete";
import "./AdminEmployerPage.css";

export default function RegistrarRecordsPage() {
    useRenderDebug("RegistrarRecordsPage");
    const navigate = useNavigate();
    const {
        isAllowed,
        records,
        setRecords,
        searchTerm,
        searchResults,
        selectedRecord,
        setSelectedRecord,
        message,
        error,
        showAddModal,
        savingRecord,
        handleSaveRecord,
        handleSearchChange,
        openAddModal,
        closeAddModal
    } = useRegistrarAdminData();

    const [deletingRecordId, setDeletingRecordId] = useState(null);
    const [deleteToast, setDeleteToast] = useState({ show: false, message: "", type: "" });
    const { scheduleDelete } = useUndoDelete();

    const handleLogout = () => {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        navigate("/");
    };

    const handleDeleteRecord = (record) => {
        if (!record?.id) return;

        setDeletingRecordId(record.id);
        // Remove from UI immediately
        setRecords((prev) => prev.filter((r) => r.id !== record.id));
        if (selectedRecord?.id === record.id) {
            setSelectedRecord(null);
        }

        scheduleDelete({
            item: record,
            itemName: record.full_name || "Record",
            message: "The alumni record was deleted.",
            deleteAction: () => api.delete(`/alumni-records/${record.id}`, true),
            restoreAction: () => {
                setRecords((prev) => {
                    const exists = prev.find((r) => r.id === record.id);
                    if (exists) return prev;
                    return [...prev, record];
                });
            },
        });
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
            title="Master Alumni Records"
            subtitle="Search, review, and add official alumni records used by the registrar verification flow."
            eyebrow="Registrar Console"
            onLogout={handleLogout}
        >
            {message && <p className="notice success">{message}</p>}
            {error && <p className="notice error">{error}</p>}

            <Toast
                show={deleteToast.show}
                onClose={() => setDeleteToast({ ...deleteToast, show: false })}
                delay={4000}
                autohide
                style={{
                    position: "fixed",
                    top: 20,
                    right: 20,
                    zIndex: 1060
                }}
            >
                <Toast.Body className={deleteToast.type === "error" ? "bg-danger text-white" : "bg-success text-white"}>
                    {deleteToast.message}
                </Toast.Body>
            </Toast>

            <section className="content-grid">
                <div className="queue-panel">
                    <div className="panel-header">
                        <h2>Search and Add Records</h2>
                        <Button variant="success" onClick={openAddModal}>
                            + Add Alumni Record
                        </Button>
                    </div>
                    <AlumniSearchBar
                        value={searchTerm}
                        onChange={handleSearchChange}
                        disabled={showAddModal}
                    />
                    <div className="mt-3">
                        {selectedRecord ? (
                            <Alert variant="success" className="mb-3">
                                Selected Record: {selectedRecord.full_name} • {selectedRecord.course} • Batch {selectedRecord.batch_year}
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
                </div>

                <aside className="audit-panel">
                    <h3>Records Summary</h3>
                    <div className="announcement-list">
                        <div className="announcement-item">
                            <div>
                                <strong>Total Records</strong>
                                <p>{records.length} alumni record(s) available.</p>
                            </div>
                        </div>
                        <div className="announcement-item">
                            <div>
                                <strong>Highlighted Record</strong>
                                <p>{selectedRecord ? selectedRecord.full_name : "No record selected yet."}</p>
                            </div>
                        </div>
                    </div>
                </aside>
            </section>

            <Row className="g-4">
                <Col lg={12}>
                    <Card className="queue-panel">
                        <Card.Body>
                            <div className="panel-header">
                                <h2>Official Master List</h2>
                                <span>{records.length} total</span>
                            </div>
                            <AlumniRecordsTable
                                records={records}
                                selectedRecordId={selectedRecord?.id}
                                onDeleteRecord={handleDeleteRecord}
                                deletingRecordId={deletingRecordId}
                            />
                        </Card.Body>
                    </Card>
                </Col>
            </Row>

            <AddAlumniModal
                show={showAddModal}
                onHide={closeAddModal}
                onSave={handleSaveRecord}
                loading={savingRecord}
            />
        </AdminShell>
    );
}