import React from "react";
import { Form, Button, Row, Col } from "react-bootstrap";
import { FaCertificate, FaPlus, FaTrash } from "react-icons/fa";

export default function ResumeCertifications({ items = [], onChange }) {
    const addItem = () => {
        onChange([...items, { name: "", issuer: "", issue_date: "", expiry_date: "", credential_id: "", url: "" }]);
    };

    const updateItem = (index, field, value) => {
        const newItems = [...items];
        newItems[index] = { ...newItems[index], [field]: value };
        onChange(newItems);
    };

    const removeItem = (index) => {
        onChange(items.filter((_, i) => i !== index));
    };

    return (
        <div className="resume-section certifications-section">
            <h5>Certifications</h5>
            {items.map((item, index) => (
                <div key={index} className="item-card mb-3 p-3 border rounded">
                    <Row>
                        <Col md={6}>
                            <Form.Group className="mb-3">
                                <Form.Label>Certification Name</Form.Label>
                                <Form.Control type="text" value={item.name || ""} onChange={(e) => updateItem(index, "name", e.target.value)} placeholder="AWS Certified Solutions Architect" />
                            </Form.Group>
                        </Col>
                        <Col md={6}>
                            <Form.Group className="mb-3">
                                <Form.Label>Issuer</Form.Label>
                                <Form.Control type="text" value={item.issuer || ""} onChange={(e) => updateItem(index, "issuer", e.target.value)} placeholder="Amazon Web Services" />
                            </Form.Group>
                        </Col>
                    </Row>
                    <Row>
                        <Col md={6}>
                            <Form.Group className="mb-3">
                                <Form.Label>Issue Date</Form.Label>
                                <Form.Control type="date" value={item.issue_date || ""} onChange={(e) => updateItem(index, "issue_date", e.target.value)} />
                            </Form.Group>
                        </Col>
                        <Col md={6}>
                            <Form.Group className="mb-3">
                                <Form.Label>Expiry Date</Form.Label>
                                <Form.Control type="date" value={item.expiry_date || ""} onChange={(e) => updateItem(index, "expiry_date", e.target.value)} />
                            </Form.Group>
                        </Col>
                    </Row>
                    <Button variant="outline-danger" size="sm" onClick={() => removeItem(index)}><FaTrash /> Remove</Button>
                </div>
            ))}
            <Button variant="outline-success" size="sm" onClick={addItem}><FaPlus /> Add Certification</Button>
        </div>
    );
}