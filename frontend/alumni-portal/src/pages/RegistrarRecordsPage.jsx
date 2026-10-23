import React, { useRef, useState } from "react";
import { Button, Toast } from "react-bootstrap";
import { FiPlus, FiUpload } from "react-icons/fi";
import { Link, useNavigate } from "react-router-dom";
import AdminShell from "../components/AdminShell";
import MasterAlumniRecordsPanel from "../components/MasterAlumniRecordsPanel";
import AddAlumniModal from "../components/AddAlumniModal";
import CsvAlumniImportModal from "../components/CsvAlumniImportModal";
import useRenderDebug from "../hooks/useRenderDebug";
import useRegistrarAdminData from "./registrar/useRegistrarAdminData";
import { api } from "../services/api";
import "./AdminEmployerPage.css";

export default function RegistrarRecordsPage() {
    useRenderDebug("RegistrarRecordsPage");
    const navigate = useNavigate();
    const {
        isAllowed,
        records,
        setRecords,
        selectedRecord,
        setSelectedRecord,
        message,
        error,
        showAddModal,
        editingRecord,
        openEditModal,
        savingRecord,
        handleSaveRecord,
        openAddModal,
        closeAddModal
    } = useRegistrarAdminData();

    const [deletingRecordId, setDeletingRecordId] = useState(null);
    const [deleteToast, setDeleteToast] = useState({ show: false, message: "", type: "" });
    const [showImportModal, setShowImportModal] = useState(false);
    const [importNotice, setImportNotice] = useState("");
    const [importRefreshError, setImportRefreshError] = useState("");
    const [refreshingRecords, setRefreshingRecords] = useState(false);
    const deletingRecordRef = useRef(null);

    const refreshImportedRecords = async () => {
        setRefreshingRecords(true);
        setImportRefreshError("");
        try {
            const data = await api.get("/alumni-records", true);
            if (!Array.isArray(data)) throw new Error("The records list could not be loaded.");
            setRecords(data);
        } catch (err) {
            setImportRefreshError(`The import succeeded, but the records list could not be refreshed. ${err.message || "Please try refreshing the records."}`);
        } finally {
            setRefreshingRecords(false);
        }
    };

    const handleImported = async (result) => {
        setShowImportModal(false);
        setImportNotice(`Imported ${result.inserted.toLocaleString()} alumni ${result.inserted === 1 ? "record" : "records"}.${result.duplicates > 0 ? ` Skipped ${result.duplicates.toLocaleString()} duplicate ${result.duplicates === 1 ? "row" : "rows"}.` : ""}`);
        await refreshImportedRecords();
    };

    const handleLogout = () => {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        navigate("/");
    };

    const handleDeleteRecord = async (record) => {
        if (!record?.id || deletingRecordRef.current !== null) return false;

        deletingRecordRef.current = record.id;
        setDeletingRecordId(record.id);
        setDeleteToast({ show: false, message: "", type: "" });
        try {
            const result = await api.delete(`/alumni-records/${encodeURIComponent(record.id)}`, true);
            if (result?.success !== true) throw new Error("The server did not confirm that the alumni record was deleted.");
            setRecords((prev) => prev.filter((item) => item.id !== record.id));
            if (selectedRecord?.id === record.id) setSelectedRecord(null);
            setDeleteToast({ show: true, message: `${record.full_name || "Alumni record"} was deleted.`, type: "success" });
            return true;
        } catch (err) {
            setDeleteToast({ show: true, message: err.message || "The alumni record could not be deleted. Please try again.", type: "error" });
            return false;
        } finally {
            deletingRecordRef.current = null;
            setDeletingRecordId(null);
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
            title="Master Alumni Records"
            subtitle="Search, review, and add official alumni records used by the registrar verification flow."
            eyebrow="Registrar Console"
            onLogout={handleLogout}
        >
            {message && <p className="notice success">{message}</p>}
            {error && <p className="notice error">{error}</p>}
            {importNotice && <p className="notice success" role="status">{importNotice}</p>}
            {importRefreshError && <div className="notice error" role="alert">{importRefreshError} <Button variant="outline-danger" size="sm" onClick={refreshImportedRecords} disabled={refreshingRecords}>Refresh records</Button></div>}

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

            <MasterAlumniRecordsPanel
                records={records}
                loading={refreshingRecords}
                selectedRecordId={selectedRecord?.id}
                onSelectRecord={setSelectedRecord}
                onDeleteRecord={handleDeleteRecord}
                onEditRecord={openEditModal}
                deletingRecordId={deletingRecordId}
                actions={<>
                    <Button variant="outline-success" onClick={() => setShowImportModal(true)} disabled={refreshingRecords}><FiUpload aria-hidden="true" />Import CSV</Button>
                    <Button variant="success" onClick={openAddModal}><FiPlus aria-hidden="true" />Add Alumni Record</Button>
                </>}
            />

            <AddAlumniModal
                show={showAddModal}
                onHide={closeAddModal}
                onSave={handleSaveRecord}
                initialRecord={editingRecord}
                error={error}
                loading={savingRecord}
            />
            {showImportModal && <CsvAlumniImportModal show onHide={() => setShowImportModal(false)} onImported={handleImported} />}
        </AdminShell>
    );
}
