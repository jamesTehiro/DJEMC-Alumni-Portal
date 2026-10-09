import React from "react";
import { Modal, Button } from "react-bootstrap";
import "./InterviewDetailsModal.css";

function formatTime12Hour(timeStr) {
    if (!timeStr) return "N/A";
    const trimmed = String(timeStr).trim();
    // If already contains AM/PM, return as-is
    if (/[ap]m/i.test(trimmed)) return trimmed;
    // Match HH:MM or HH:MM:SS patterns
    const match = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!match) return trimmed;
    let hours = parseInt(match[1], 10);
    const minutes = match[2];
    const ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12 || 12;
    return `${hours}:${minutes} ${ampm}`;
}

export default function InterviewDetailsModal({ show, onHide, notification }) {
    const interview = notification?.Interview;
    const formattedDate = interview?.date
        ? new Date(`${interview.date}T00:00:00`).toLocaleDateString()
        : "N/A";

    return (
        <Modal show={show} onHide={onHide} centered dialogClassName="interview-details-dialog">
            <Modal.Header closeButton>
                <Modal.Title>Interview Details</Modal.Title>
            </Modal.Header>
            <Modal.Body className="interview-details-body">
                <div className="interview-details-grid">
                    <div className="interview-detail-card interview-detail-card-wide">
                        <span className="interview-detail-label">Venue</span>
                        <strong className="interview-detail-value">{interview?.venue || "N/A"}</strong>
                    </div>
                    <div className="interview-detail-card interview-detail-card-wide">
                        <span className="interview-detail-label">Place / Address</span>
                        <strong className="interview-detail-value">{interview?.place || "N/A"}</strong>
                    </div>
                    <div className="interview-detail-card">
                        <span className="interview-detail-label">Interview Date</span>
                        <strong className="interview-detail-value">{formattedDate}</strong>
                    </div>
                    <div className="interview-detail-card">
                        <span className="interview-detail-label">Interview Time</span>
                        <strong className="interview-detail-value">{formatTime12Hour(interview?.time)}</strong>
                    </div>
                    <div className="interview-detail-card interview-detail-card-wide">
                        <span className="interview-detail-label">Employer Contact Info</span>
                        <strong className="interview-detail-value">{interview?.contact_info || "N/A"}</strong>
                    </div>
                </div>

                <div className="interview-note-panel">
                    <span className="interview-detail-label">What to Bring</span>
                    <p className="interview-note-copy">
                        {interview?.what_to_bring || "No specific items were listed by the employer."}
                    </p>
                </div>
            </Modal.Body>
            <Modal.Footer className="interview-details-footer">
                <Button variant="secondary" onClick={onHide} className="interview-close-btn">
                    Close
                </Button>
            </Modal.Footer>
        </Modal>
    );
}
