import React, { useRef, useState } from "react";
import { Alert, Button, Form, Modal, Spinner, Table } from "react-bootstrap";
import { FiDownload, FiUpload } from "react-icons/fi";
import { api } from "../services/api";
import "./CsvAlumniImportModal.css";

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const TEMPLATE_URL = `data:text/csv;charset=utf-8,${encodeURIComponent("full_name,course,batch_year,student_id,email\r\n")}`;

export default function CsvAlumniImportModal({ show, onHide, onImported }) {
    const [file, setFile] = useState(null);
    const [review, setReview] = useState(null);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState("");
    const requestInProgress = useRef(false);
    const canImport = !!file && review?.mode === "preview" && review.errors === 0 && review.valid > 0;
    const preview = Array.isArray(review?.preview) ? review.preview.slice(0, 5) : [];
    const issues = Array.isArray(review?.issues) ? review.issues : [];

    const handleFileChange = (event) => {
        const selectedFile = event.target.files?.[0] || null;
        setReview(null);
        setError("");
        setFile(null);
        if (!selectedFile) return;
        if (!/\.csv$/i.test(selectedFile.name)) {
            setError("Choose a file with a .csv extension.");
        } else if (!selectedFile.size) {
            setError("The selected CSV file is empty.");
        } else if (selectedFile.size > MAX_FILE_BYTES) {
            setError("The CSV file must be 2 MB or smaller.");
        } else {
            setFile(selectedFile);
        }
    };

    const uploadFile = (mode) => {
        const payload = new FormData();
        payload.append("file", file);
        payload.append("mode", mode);
        return api.post("/alumni-records/import-csv", payload, true);
    };

    const handleReview = async () => {
        if (!file || requestInProgress.current) return;
        requestInProgress.current = true;
        setBusy("preview");
        setReview(null);
        setError("");
        try {
            const result = await uploadFile("preview");
            if (result?.mode !== "preview") throw new Error("The CSV review could not be loaded. Please try again.");
            setReview(result);
        } catch (err) {
            setError(err.message || "Unable to review this CSV file.");
        } finally {
            requestInProgress.current = false;
            setBusy("");
        }
    };

    const handleImport = async () => {
        if (!canImport || requestInProgress.current) return;
        requestInProgress.current = true;
        setBusy("import");
        setError("");
        let result;
        try {
            result = await uploadFile("import");
            if (result?.mode !== "import") throw new Error("The import result could not be confirmed. Review the CSV before retrying.");
        } catch (err) {
            result = null;
            setReview(null);
            setError(err.message || "Unable to import this CSV file. Review the CSV before retrying.");
        } finally {
            requestInProgress.current = false;
            setBusy("");
        }
        if (result) await onImported(result);
    };

    const handleClose = () => {
        if (!requestInProgress.current) onHide();
    };

    return (
        <Modal show={show} onHide={handleClose} size="lg" centered className="csv-alumni-import-modal" backdrop={busy ? "static" : true} keyboard={!busy}>
            <Modal.Header closeButton={!busy}>
                <Modal.Title>Import Alumni Records from CSV</Modal.Title>
            </Modal.Header>
            <Modal.Body aria-busy={!!busy}>
                <p className="csv-alumni-import-intro">Choose a CSV file, review its records, then confirm the import. Records are checked again when you confirm, and duplicates are skipped.</p>
                <div className="csv-alumni-import-requirements">
                    <p>Required headers: <code>full_name</code>, <code>course</code>, <code>batch_year</code></p>
                    <p>Optional headers: <code>student_id</code>, <code>email</code></p>
                    <p>Save as UTF-8 CSV. Maximum 2 MB and 1,000 data rows.</p>
                    <Button as="a" href={TEMPLATE_URL} download="alumni-records-template.csv" variant="outline-success" size="sm"><FiDownload aria-hidden="true" /> Download CSV template</Button>
                </div>

                <Form.Group controlId="csv-alumni-import-file" className="mt-3">
                    <Form.Label>CSV file</Form.Label>
                    <Form.Control type="file" accept=".csv,text/csv" onChange={handleFileChange} disabled={!!busy} aria-describedby="csv-alumni-import-file-help" />
                    <Form.Text id="csv-alumni-import-file-help">{file ? `${file.name} (${Math.ceil(file.size / 1024).toLocaleString()} KB)` : "Choose the alumni records CSV to review."}</Form.Text>
                </Form.Group>

                {error && <Alert variant="danger" className="mt-3 mb-0" role="alert">{error}</Alert>}

                {review && <section className="csv-alumni-import-review" aria-label="CSV review results" aria-live="polite">
                    <h2>Review results</h2>
                    <div className="csv-alumni-import-counts">
                        {[
                            { label: "Total rows", count: review.total, tone: "total" },
                            { label: "Ready to import", count: review.valid, tone: "valid" },
                            { label: "Duplicate rows", count: review.duplicates, tone: "duplicate" },
                            { label: "Invalid rows", count: review.errors, tone: "invalid" }
                        ].map(({ label, count, tone }) => <div key={label} className={`csv-alumni-import-count ${tone}`}><strong>{Number(count || 0).toLocaleString()}</strong><span>{label}</span></div>)}
                    </div>

                    {review.errors > 0 ? <Alert variant="danger">Correct all invalid rows in your CSV, select the updated file, and review it again before importing.</Alert> : review.valid > 0 ? <Alert variant="success">Ready to import {review.valid.toLocaleString()} alumni {review.valid === 1 ? "record" : "records"}. Confirm Import will save these records.</Alert> : <Alert variant="info">There are no new records to import.</Alert>}
                    {review.duplicates > 0 && <p className="csv-alumni-import-duplicate-note">{review.duplicates.toLocaleString()} duplicate {review.duplicates === 1 ? "row will" : "rows will"} be skipped.</p>}

                    {issues.length > 0 && <div className="csv-alumni-import-issues">
                        <h3>Row messages</h3>
                        <ul>{issues.map((issue, index) => <li key={`${issue.row}-${issue.kind}-${index}`}><span className={`csv-alumni-import-issue-kind ${issue.kind === "invalid" ? "invalid" : "duplicate"}`}>{issue.kind === "invalid" ? "Invalid" : "Duplicate"}</span> <strong>Row {issue.row}:</strong> {issue.message}</li>)}</ul>
                    </div>}

                    {preview.length > 0 && <div className="csv-alumni-import-preview">
                        <h3>Record preview</h3>
                        <p>Showing the first {preview.length} {preview.length === 1 ? "record" : "records"} ready to import.</p>
                        <Table responsive size="sm" className="mb-0">
                            <thead><tr><th>CSV row</th><th>Full name</th><th>Program</th><th>Year graduated</th></tr></thead>
                            <tbody>{preview.map((record) => <tr key={record.row}><td>{record.row}</td><td>{record.full_name}</td><td>{record.course}</td><td>{record.batch_year}</td></tr>)}</tbody>
                        </Table>
                    </div>}
                </section>}
            </Modal.Body>
            <Modal.Footer>
                <Button variant="secondary" onClick={handleClose} disabled={!!busy}>Cancel</Button>
                <Button variant="outline-success" onClick={handleReview} disabled={!file || !!busy}>{busy === "preview" && <Spinner animation="border" size="sm" aria-hidden="true" />} {busy === "preview" ? "Reviewing CSV..." : "Review CSV"}</Button>
                {canImport && <Button variant="success" onClick={handleImport} disabled={!!busy}>{busy === "import" ? <Spinner animation="border" size="sm" aria-hidden="true" /> : <FiUpload aria-hidden="true" />} {busy === "import" ? "Importing..." : "Confirm Import"}</Button>}
            </Modal.Footer>
        </Modal>
    );
}
