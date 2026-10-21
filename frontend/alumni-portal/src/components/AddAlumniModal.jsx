import React, { useEffect, useRef, useState } from "react";
import { Button, Form, Modal } from "react-bootstrap";
import AcademicProgramFields from "./AcademicProgramFields";

export default function AddAlumniModal({ show, onHide, onSave, loading, initialRecord, error }) {
    const formRef = useRef(null);
    const [form, setForm] = useState({
        full_name: "",
        course: "",
        major: "",
        batch_year: "",
        email: ""
    });
    useEffect(() => {
        if (show) setForm({ full_name: initialRecord?.full_name || "", course: initialRecord?.course || "", major: initialRecord?.major || "", batch_year: initialRecord?.batch_year || "", email: initialRecord?.email || "" });
    }, [show, initialRecord]);

    const handleChange = (e) => {
        setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
    };

    const handleSubmit = async () => {
        if (!formRef.current.reportValidity()) return;
        await onSave({ ...form, course: form.course.trim(), major: form.major.trim() });
    };

    return (
        <Modal show={show} onHide={onHide} centered>
            <Modal.Header closeButton>
                <Modal.Title>{initialRecord ? "Edit" : "Add"} Alumni Record</Modal.Title>
            </Modal.Header>
            <Modal.Body>
                {error && <p className="text-danger" role="alert">{error}</p>}
                <Form ref={formRef} className="form-stack" onSubmit={event => { event.preventDefault(); handleSubmit(); }}>
                    <Form.Group>
                        <Form.Label>Full Name</Form.Label>
                        <Form.Control required maxLength={255} name="full_name" value={form.full_name} onChange={handleChange} />
                    </Form.Group>
                    <AcademicProgramFields course={form.course} major={form.major} allowLegacy={Boolean(initialRecord && form.course === initialRecord.course)} allowMissingMajor={Boolean(initialRecord && form.course === initialRecord.course && !initialRecord.major)} onChange={academic => setForm(prev => ({ ...prev, ...academic }))} />
                    <Form.Group>
                        <Form.Label>Batch Year</Form.Label>
                        <Form.Control required name="batch_year" value={form.batch_year} onChange={handleChange} />
                    </Form.Group>
                </Form>
            </Modal.Body>
            <Modal.Footer>
                <Button variant="secondary" onClick={onHide}>Cancel</Button>
                <Button variant="success" onClick={handleSubmit} disabled={loading}>Save</Button>
            </Modal.Footer>
        </Modal>
    );
}
