import React from "react";
import { Form, Button, Row, Col } from "react-bootstrap";
import { FaUsers, FaPlus, FaTrash } from "react-icons/fa";

export default function ResumeSeminars({ items = [], onChange }) {
    const addItem = () => {
        onChange([...items, { seminar_name: "", organizer: "", date: "", description: "" }]);
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
        <div className="resume-section seminars-section">
            <h5>Seminars</h5>
            {items.map((item, index) => (
                <div key={index} className="item-card mb-3 p-3 border rounded">
                    <Row>
                        <Col md={6}>
                            <Form.Group className="mb-3">
                                <Form.Label>Seminar Name</Form.Label>
                                <Form.Control type="text" value={item.seminar_name || ""} onChange={(e) => updateItem(index, "seminar_name", e.target.value)} placeholder="Leadership Seminar" />
                            </Form.Group>
                        </Col>
                        <Col md={6}>
                            <Form.Group className="mb-3">
                                <Form.Label>Organizer</Form.Label>
                                <Form.Control type="text" value={item.organizer || ""} onChange={(e) => updateItem(index, "organizer", e.target.value)} placeholder="ABC Corp" />
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
            <Button variant="outline-success" size="sm" onClick={addItem}><FaPlus /> Add Seminar</Button>
        </div>
    );
}