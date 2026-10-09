import React, { useState } from "react";
import { Button, Form, Modal } from "react-bootstrap";

export default function AddAlumniModal({ show, onHide, onSave, loading }) {
    const [form, setForm] = useState({
        full_name: "",
        course: "",
        batch_year: "",
        email: ""
    });

    const handleChange = (e) => {
        setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
    };

    const handleSubmit = async () => {
        await onSave(form);
        setForm({ full_name: "", course: "", batch_year: "", email: "" });
    };

    return (
        <Modal show={show} onHide={onHide} centered>
            <Modal.Header closeButton>
                <Modal.Title>Add Alumni Record</Modal.Title>
            </Modal.Header>
            <Modal.Body>
                <Form className="form-stack">
                    <Form.Group>
                        <Form.Label>Full Name</Form.Label>
                        <Form.Control name="full_name" value={form.full_name} onChange={handleChange} />
                    </Form.Group>
                    <Form.Group>
                        <Form.Label>Course</Form.Label>
                        <Form.Control name="course" value={form.course} onChange={handleChange} />
                    </Form.Group>
                    <Form.Group>
                        <Form.Label>Batch Year</Form.Label>
                        <Form.Control name="batch_year" value={form.batch_year} onChange={handleChange} />
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
