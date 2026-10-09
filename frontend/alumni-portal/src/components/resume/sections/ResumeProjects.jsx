import React from "react";
import { Form, Button, Row, Col } from "react-bootstrap";
import { FaProjectDiagram, FaPlus, FaTrash } from "react-icons/fa";

export default function ResumeProjects({ items = [], onChange }) {
    const addItem = () => {
        onChange([...items, { project_name: "", description: "", technologies: "", url: "", start_date: "", end_date: "", is_current: false }]);
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
        <div className="resume-section projects-section">
            <h5>Projects</h5>
            {items.map((item, index) => (
                <div key={index} className="item-card mb-3 p-3 border rounded">
                    <Row>
                        <Col md={6}>
                            <Form.Group className="mb-3">
                                <Form.Label>Project Name</Form.Label>
                                <Form.Control type="text" value={item.project_name || ""} onChange={(e) => updateItem(index, "project_name", e.target.value)} placeholder="My Awesome Project" />
                            </Form.Group>
                        </Col>
                        <Col md={6}>
                            <Form.Group className="mb-3">
                                <Form.Label>URL</Form.Label>
                                <Form.Control type="url" value={item.url || ""} onChange={(e) => updateItem(index, "url", e.target.value)} placeholder="https://example.com/project" />
                            </Form.Group>
                        </Col>
                    </Row>
                    <Form.Group className="mb-3">
                        <Form.Label>Description</Form.Label>
                        <Form.Control as="textarea" rows={3} value={item.description || ""} onChange={(e) => updateItem(index, "description", e.target.value)} placeholder="Describe the project..." />
                    </Form.Group>
                    <Form.Group className="mb-3">
                        <Form.Label>Technologies</Form.Label>
                        <Form.Control type="text" value={item.technologies || ""} onChange={(e) => updateItem(index, "technologies", e.target.value)} placeholder="React, Node.js, MySQL" />
                    </Form.Group>
                    <Button variant="outline-danger" size="sm" onClick={() => removeItem(index)}><FaTrash /> Remove</Button>
                </div>
            ))}
            <Button variant="outline-success" size="sm" onClick={addItem}><FaPlus /> Add Project</Button>
        </div>
    );
}
