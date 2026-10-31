import React from "react";
import { Form, Button, Row, Col } from "react-bootstrap";
import { FaGraduationCap, FaPlus, FaTrash } from "react-icons/fa";

export default function ResumeTrainings({ items = [], onChange }) {
    const addItem = () => {
        onChange([...items, { training_name: "", provider: "", completion_date: "", description: "" }]);
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
        <div className="resume-section trainings-section">
            <h5>Trainings</h5>
            {items.map((item, index) => (
                <div key={index} className="item-card mb-3 p-3 border rounded">
                    <Row>
                        <Col md={6}>
                            <Form.Group className="mb-3">
                                <Form.Label>Training Name</Form.Label>
                                <Form.Control type="text" value={item.training_name || ""} onChange={(e) => updateItem(index, "training_name", e.target.value)} placeholder="Leadership Training" />
                            </Form.Group>
                        </Col>
                        <Col md={6}>
                            <Form.Group className="mb-3">
                                <Form.Label>Provider</Form.Label>
                                <Form.Control type="text" value={item.provider || ""} onChange={(e) => updateItem(index, "provider", e.target.value)} placeholder="ABC Institute" />
                            </Form.Group>
                        </Col>
                    </Row>
                    <Form.Group className="mb-3">
                        <Form.Label>Description</Form.Label>
                        <Form.Control as="textarea" rows={3} value={item.description || ""} onChange={(e) => updateItem(index, "description", e.target.value)} />
                    </Form.Group>
                    <Button variant="outline-danger" size="sm" onClick={() => removeItem(index)}><FaTrash /> Remove</Button>
                </div>
            ))}
            <Button variant="outline-success" size="sm" onClick={addItem}><FaPlus /> Add Training</Button>
        </div>
    );
}