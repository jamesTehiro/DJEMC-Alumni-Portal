import React from "react";
import { Form, Button, Row, Col } from "react-bootstrap";
import { FaUsers, FaPlus, FaTrash } from "react-icons/fa";

export default function ResumeVolunteerWork({ items = [], onChange }) {
    const addItem = () => {
        onChange([...items, { role: "", organization: "", start_date: "", end_date: "", is_current: false, description: "" }]);
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
        <div className="resume-section volunteer-work-section">
            <h5>Volunteer Experience</h5>
            {items.map((item, index) => (
                <div key={index} className="item-card mb-3 p-3 border rounded">
                    <Row>
                        <Col md={6}>
                            <Form.Group className="mb-3">
                                <Form.Label>Role</Form.Label>
                                <Form.Control type="text" value={item.role || ""} onChange={(e) => updateItem(index, "role", e.target.value)} placeholder="Volunteer Teacher" />
                            </Form.Group>
                        </Col>
                        <Col md={6}>
                            <Form.Group className="mb-3">
                                <Form.Label>Organization</Form.Label>
                                <Form.Control type="text" value={item.organization || ""} onChange={(e) => updateItem(index, "organization", e.target.value)} placeholder="Community Outreach Program" />
                            </Form.Group>
                        </Col>
                    </Row>
                    <Button variant="outline-danger" size="sm" onClick={() => removeItem(index)}><FaTrash /> Remove</Button>
                </div>
            ))}
            <Button variant="outline-success" size="sm" onClick={addItem}><FaPlus /> Add Volunteer Experience</Button>
        </div>
    );
}