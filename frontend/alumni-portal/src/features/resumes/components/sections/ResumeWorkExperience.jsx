import React from "react";
import { Form, Button, InputGroup, Row, Col, Card } from "react-bootstrap";
import { FaBriefcase, FaPlus, FaTrash } from "react-icons/fa";

export default function ResumeWorkExperience({ items = [], onChange }) {
    const addItem = () => {
        onChange([...items, {
            job_title: "",
            company: "",
            location: "",
            start_date: "",
            end_date: "",
            is_current: false,
            description: ""
        }]);
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
        <div className="resume-section work-experience-section">
            <h5>Work Experience</h5>
            {items.map((item, index) => (
                <Card key={index} className="mb-3 item-card">
                    <Card.Body>
                        <Row>
                            <Col md={6}>
                                <Form.Group className="mb-3">
                                    <Form.Label>Job Title *</Form.Label>
                                    <InputGroup>
                                        <InputGroup.Text><FaBriefcase /></InputGroup.Text>
                                        <Form.Control
                                            type="text"
                                            value={item.job_title || ""}
                                            onChange={(e) => updateItem(index, "job_title", e.target.value)}
                                            placeholder="Software Engineer"
                                        />
                                    </InputGroup>
                                </Form.Group>
                            </Col>
                            <Col md={6}>
                                <Form.Group className="mb-3">
                                    <Form.Label>Company *</Form.Label>
                                    <Form.Control
                                        type="text"
                                        value={item.company || ""}
                                        onChange={(e) => updateItem(index, "company", e.target.value)}
                                        placeholder="Google"
                                    />
                                </Form.Group>
                            </Col>
                        </Row>

                        <Row>
                            <Col md={6}>
                                <Form.Group className="mb-3">
                                    <Form.Label>Location</Form.Label>
                                    <Form.Control
                                        type="text"
                                        value={item.location || ""}
                                        onChange={(e) => updateItem(index, "location", e.target.value)}
                                        placeholder="Mountain View, CA"
                                    />
                                </Form.Group>
                            </Col>
                            <Col md={6}>
                                <Form.Group className="mb-3">
                                    <Form.Label>Start Date</Form.Label>
                                    <Form.Control
                                        type="date"
                                        value={item.start_date || ""}
                                        onChange={(e) => updateItem(index, "start_date", e.target.value)}
                                    />
                                </Form.Group>
                            </Col>
                        </Row>

                        <Row>
                            <Col md={6}>
                                <Form.Group className="mb-3">
                                    <Form.Label>End Date</Form.Label>
                                    <Form.Control
                                        type="date"
                                        value={item.end_date || ""}
                                        onChange={(e) => updateItem(index, "end_date", e.target.value)}
                                        disabled={item.is_current}
                                    />
                                </Form.Group>
                            </Col>
                        </Row>

                        <Form.Group className="mb-3">
                            <Form.Check
                                type="checkbox"
                                label="Currently working here"
                                checked={item.is_current || false}
                                onChange={(e) => updateItem(index, "is_current", e.target.checked)}
                            />
                        </Form.Group>

                        <Form.Group className="mb-3">
                            <Form.Label>Description</Form.Label>
                            <Form.Control
                                as="textarea"
                                rows={4}
                                value={item.description || ""}
                                onChange={(e) => updateItem(index, "description", e.target.value)}
                                placeholder="Describe your responsibilities, achievements, and key contributions..."
                            />
                        </Form.Group>

                        <Button variant="outline-danger" size="sm" onClick={() => removeItem(index)}>
                            <FaTrash /> Remove
                        </Button>
                    </Card.Body>
                </Card>
            ))}
            <Button variant="outline-success" size="sm" onClick={addItem}>
                <FaPlus /> Add Work Experience
            </Button>
        </div>
    );
}