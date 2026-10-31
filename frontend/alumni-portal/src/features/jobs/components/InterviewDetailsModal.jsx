import React, { useEffect, useState } from "react";
import { Alert, Button, Form, Modal } from "react-bootstrap";

const fields = [
    { key: "venue", label: "Venue", required: true },
    { key: "place", label: "Place / Address", required: true, multiline: true },
    { key: "date", label: "Interview Date", required: true, type: "date" },
    { key: "time", label: "Interview Time", required: true, type: "time" },
    { key: "contact_info", label: "Contact Information (Email or Phone)", required: true },
    { key: "what_to_bring", label: "What to Bring", multiline: true }
];

export const EMPTY_INTERVIEW_DETAILS = Object.freeze({
    venue: "", place: "", date: "", time: "", contact_info: "", what_to_bring: ""
});

export default function InterviewDetailsModal({
    show,
    onHide,
    jobTitle,
    values,
    onChange,
    onSave,
    mode = "draft",
    configured = false,
    loading = false,
    saving = false,
    loadError = "",
    saveError = "",
    onRetry,
    notification,
    notificationLoading = false,
    notificationError = "",
    onNotificationRetry
}) {
    const [validationError, setValidationError] = useState("");
    const isDraft = mode === "draft";

    useEffect(() => {
        if (show) setValidationError("");
    }, [show]);

    const submit = (event) => {
        event.preventDefault();
        if (loading || loadError) return;
        const missing = fields.find((field) => field.required && !String(values?.[field.key] || "").trim());
        if (missing) {
            setValidationError(`${missing.label} is required.`);
            return;
        }
        setValidationError("");
        onSave();
    };

    if (notification) {
        const details = notification.Interview;
        const interviewDate = details?.date ? new Date(`${details.date}T00:00:00`) : null;
        const formattedDate = interviewDate && !Number.isNaN(interviewDate.getTime())
            ? interviewDate.toLocaleDateString()
            : details?.date || "Not provided";

        return (
            <Modal show={show} onHide={onHide} centered className="notification-interview-details-modal">
                <Modal.Header closeButton>
                    <Modal.Title>Interview Invitation &amp; Details</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    {notificationLoading && <div className="text-center py-4" role="status">Loading interview details…</div>}
                    {!notificationLoading && notificationError && (
                        <Alert variant="danger" role="alert">
                            <div>{notificationError}</div>
                            {onNotificationRetry && <Button className="mt-2" size="sm" variant="outline-danger" onClick={onNotificationRetry}>Retry loading invitation</Button>}
                        </Alert>
                    )}
                    {!notificationLoading && !notificationError && !details && (
                        <Alert variant="warning" role="alert">Interview details are not available for this notification.</Alert>
                    )}
                    {!notificationLoading && !notificationError && details && (
                        <>
                            <p className="notification-interview-message">{notification.message}</p>
                            <dl className="notification-interview-summary">
                                <dt>Venue</dt><dd>{details.venue || "Not provided"}</dd>
                                <dt>Place / Address</dt><dd>{details.place || "Not provided"}</dd>
                                <dt>Interview Date</dt><dd>{formattedDate}</dd>
                                <dt>Interview Time</dt><dd>{details.time || "Not provided"}</dd>
                                <dt>Contact Information</dt><dd>{details.contact_info || "Not provided"}</dd>
                                <dt>What to Bring</dt><dd>{details.what_to_bring || "No additional items specified."}</dd>
                            </dl>
                        </>
                    )}
                </Modal.Body>
                <Modal.Footer>
                    <Button variant="secondary" onClick={onHide}>Close</Button>
                </Modal.Footer>
            </Modal>
        );
    }

    return (
        <Modal show={show} onHide={saving ? undefined : onHide} centered className="interview-details-modal">
            <Form onSubmit={submit}>
                <Modal.Header closeButton={!saving}>
                    <Modal.Title>Interview Invitation &amp; Details</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <p className="interview-details-job">{jobTitle ? `Job: ${jobTitle}` : "Configure details for this job posting."}</p>
                    {!configured && (
                        <Alert variant="info">
                            Interview details are required before publishing or approving an applicant. Complete Venue, Place / Address, Interview Date, Interview Time, and Contact Information.
                        </Alert>
                    )}
                    {validationError && <Alert variant="danger" role="alert">{validationError}</Alert>}
                    {saveError && <Alert variant="danger" role="alert">{saveError}</Alert>}
                    {loading ? <div className="text-center py-4" role="status">Loading saved interview details…</div> : loadError ? (
                        <Alert variant="danger" role="alert">
                            <div>{loadError}</div>
                            {onRetry && <Button className="mt-2" size="sm" variant="outline-danger" type="button" onClick={onRetry}>Retry loading details</Button>}
                        </Alert>
                    ) : (
                        fields.map((field) => (
                            <Form.Group className="mb-3" key={field.key}>
                                <Form.Label>{field.label}{field.required ? " *" : ""}</Form.Label>
                                <Form.Control
                                    type={field.type || undefined}
                                    as={field.multiline ? "textarea" : undefined}
                                    rows={field.multiline ? 2 : undefined}
                                    value={values?.[field.key] || ""}
                                    onChange={(event) => {
                                        setValidationError("");
                                        onChange(field.key, event.target.value);
                                    }}
                                    required={field.required}
                                    disabled={loading || saving}
                                />
                            </Form.Group>
                        ))
                    )}
                </Modal.Body>
                <Modal.Footer>
                    <Button variant="outline-secondary" type="button" onClick={onHide} disabled={saving}>Cancel</Button>
                    <Button variant="success" type="submit" disabled={loading || saving || Boolean(loadError)}>
                        {saving ? "Saving…" : isDraft ? "Save" : "Save Changes"}
                    </Button>
                </Modal.Footer>
            </Form>
        </Modal>
    );
}
