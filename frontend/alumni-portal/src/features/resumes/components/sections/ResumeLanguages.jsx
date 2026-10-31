import React from "react";
import { Form, Button, Row, Col } from "react-bootstrap";
import { FaLanguage, FaPlus, FaTrash } from "react-icons/fa";

export default function ResumeLanguages({ items = [], onChange }) {
    const addItem = () => {
        onChange([...items, { language: "", proficiency: "" }]);
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
        <div className="resume-section languages-section">
            <h5>Languages</h5>
            {items.map((item, index) => (
                <div key={index} className="item-card mb-3 p-3 border rounded">
                    <Row>
                        <Col md={6}>
                            <Form.Group className="mb-3">
                                <Form.Label>Language</Form.Label>
                                <Form.Control type="text" value={item.language || ""} onChange={(e) => updateItem(index, "language", e.target.value)} placeholder="English" />
                            </Form.Group>
                        </Col>
                        <Col md={6}>
                            <Form.Group className="mb-3">
                                <Form.Label>Proficiency</Form.Label>
                                <Form.Control type="text" value={item.proficiency || ""} onChange={(e) => updateItem(index, "proficiency", e.target.value)} placeholder="Fluent" />
                            </Form.Group>
                        </Col>
                    </Row>
                    <Button variant="outline-danger" size="sm" onClick={() => removeItem(index)}><FaTrash /> Remove</Button>
                </div>
            ))}
            <Button variant="outline-success" size="sm" onClick={addItem}><FaPlus /> Add Language</Button>
        </div>
    );
}