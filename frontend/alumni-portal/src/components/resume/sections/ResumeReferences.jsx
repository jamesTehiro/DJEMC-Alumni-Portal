import React from "react";
import { Form, Button, Row, Col } from "react-bootstrap";
import { FaUsers, FaPlus, FaTrash } from "react-icons/fa";

export default function ResumeReferences({ items = [], onChange }) {
    const addItem = () => {
        onChange([...items, { name: "", relationship: "", company: "", email: "", phone: "" }]);
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
        <div className="resume-section references-section">
            <h5>References</h5>
            {items.map((item, index) => (
                <div key={index} className="item-card mb-3 p-3 border rounded">
                    <Row>
                        <Col md={6}>
                            <Form.Group className="mb-3">
                                <Form.Label>Full Name</Form.Label>
                                <Form.Control type="text" value={item.name || ""} onChange={(e) => updateItem(index, "name", e.target.value)} placeholder="Reference name" />
                            </Form.Group>
                        </Col>
                        <Col md={6}>
                            <Form.Group className="mb-3">
                                <Form.Label>Relationship</Form.Label>
                                <Form.Control type="text" value={item.relationship || ""} onChange={(e) => updateItem(index, "relationship", e.target.value)} placeholder="Former Supervisor" />
                            </Form.Group>
                        </Col>
                    </Row>
                    <Row>
                        <Col md={6}>
                            <Form.Group className="mb-3">
                                <Form.Label>Company</Form.Label>
                                <Form.Control type="text" value={item.company || ""} onChange={(e) => updateItem(index, "company", e.target.value)} placeholder="Company Name" />
                            </Form.Group>
                        </Col>
                        <Col md={6}>
                            <Form.Group className="mb-3">
                                <Form.Label>Email</Form.Label>
                                <Form.Control type="email" value={item.email || ""} onChange={(e) => updateItem(index, "email", e.target.value)} placeholder="reference@example.com" />
                            </Form.Group>
                        </Col>
                    </Row>
                    <Button variant="outline-danger" size="sm" onClick={() => removeItem(index)}><FaTrash /> Remove</Button>
                </div>
            ))}
            <Button variant="outline-success" size="sm" onClick={addItem}><FaPlus /> Add Reference</Button>
        </div>
    );
}