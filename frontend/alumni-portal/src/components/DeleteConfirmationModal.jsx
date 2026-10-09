import React from "react";
import { Button, Modal } from "react-bootstrap";

export default function DeleteConfirmationModal({
    show,
    onHide,
    onConfirm,
    record,
    loading
}) {
    if (!record) return null;

    return (
        <Modal show={show} onHide={onHide} centered>
            <Modal.Header closeButton>
                <Modal.Title>Delete Alumni Record</Modal.Title>
            </Modal.Header>
            <Modal.Body>
                <p>Are you sure you want to permanently remove</p>
                <p><strong>{record.full_name}</strong></p>
                <p style={{ color: "#6b7280", fontSize: "0.9em" }}>
                    {record.course} • Batch {record.batch_year}
                </p>
                <p className="text-danger mt-2 mb-0">
                    <small>This action cannot be undone.</small>
                </p>
            </Modal.Body>
            <Modal.Footer>
                <Button variant="secondary" onClick={onHide} disabled={loading}>
                    Cancel
                </Button>
                <Button
                    variant="danger"
                    onClick={onConfirm}
                    disabled={loading}
                >
                    {loading ? "Deleting..." : "Delete"}
                </Button>
            </Modal.Footer>
        </Modal>
    );
}