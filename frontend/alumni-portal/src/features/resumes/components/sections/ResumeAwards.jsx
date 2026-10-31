import React from "react";
import { Form, Button, Row, Col } from "react-bootstrap";
import { FaAward, FaPlus, FaTrash } from "react-icons/fa";

export default function ResumeAwards({ items = [], onChange }) {
    const addItem = () => {
        onChange([...items, { title: "", issuer: "", date: "", description: "" }]);
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
        <div className="resume-section awards-section">
            <h5>Awards & Honors</h5>
            {items.map((item, index) => (
                <div key={index} className="item-card mb-3 p-3 border rounded">
                    <Row>
                        <Col md={6}>
                            <Form.Group className="mb-3">
                                <Form.Label>Title</Form.Label>
                                <Form.Control type="text" value={item.title || ""} onChange={(e) => updateItem(index, "title", e.target.value)} placeholder="Employee of the Year" />
                            </Form.Group>
                        </Col>
                        <Col md={6}>
                            <Form.Group className="mb-3">
                                <Form.Label>Issuer</Form.Label>
                                <Form.Control type="text" value={item.issuer || ""} onChange={(e) => updateItem(index, "issuer", e.target.value)} placeholder="Company Name" />
                            </Form.Group>
                        </Col>
                    </Row>
                    <Form.Group className="mb-3">
                        <Form.Label>Date</Form.Label>
                        <Form.Control type="date" value={item.date || ""} onChange={(e) => updateItem(index, "date", e.target.value)} />
                    </Form.Group>
                    <Button variant="outline-danger" size="sm" onClick={() => removeItem(index)}><FaTrash /> Remove</Button>
                </div>
            ))}
            <Button variant="outline-success" size="sm" onClick={addItem}><FaPlus /> Add Award</Button>
        </div>
    );
}