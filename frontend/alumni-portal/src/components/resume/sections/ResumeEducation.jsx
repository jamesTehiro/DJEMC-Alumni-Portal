import React from "react";
import { Form, Button, InputGroup, Row, Col, Card } from "react-bootstrap";
import { FaGraduationCap, FaPlus, FaTrash } from "react-icons/fa";

export default function ResumeEducation({ items = [], onChange }) {
    const addItem = () => {
        onChange([...items, {
            institution: "",
            degree: "",
            field_of_study: "",
            start_date: "",
            end_date: "",
            is_current: false,
            gpa: "",
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
        <div className="resume-section education-section">
            <h5>Education</h5>
            {items.map((item, index) => (
                <Card key={index} className="mb-3 item-card">
                    <Card.Body>
                        <Row>
                            <Col md={6}>
                                <Form.Group className="mb-3">
                                    <Form.Label>Institution *</Form.Label>
                                    <InputGroup>
                                        <InputGroup.Text><FaGraduationCap /></InputGroup.Text>
                                        <Form.Control
                                            type="text"
                                            value={item.institution || ""}
                                            onChange={(e) => updateItem(index, "institution", e.target.value)}
                                            placeholder="University of the Philippines"
                                        />
                                    </InputGroup>
                                </Form.Group>
                            </Col>
                            <Col md={6}>
                                <Form.Group className="mb-3">
                                    <Form.Label>Degree *</Form.Label>
                                    <Form.Control
                                        type="text"
                                        value={item.degree || ""}
                                        onChange={(e) => updateItem(index, "degree", e.target.value)}
                                        placeholder="Bachelor of Science"
                                    />
                                </Form.Group>
                            </Col>
                        </Row>

                        <Row>
                            <Col md={6}>
                                <Form.Group className="mb-3">
                                    <Form.Label>Field of Study</Form.Label>
                                    <Form.Control
                                        type="text"
                                        value={item.field_of_study || ""}
                                        onChange={(e) => updateItem(index, "field_of_study", e.target.value)}
                                        placeholder="Computer Science"
                                    />
                                </Form.Group>
                            </Col>
                            <Col md={6}>
                                <Form.Group className="mb-3">
                                    <Form.Label>GPA</Form.Label>
                                    <Form.Control
                                        type="text"
                                        value={item.gpa || ""}
                                        onChange={(e) => updateItem(index, "gpa", e.target.value)}
                                        placeholder="1.5 / 4.0"
                                    />
                                </Form.Group>
                            </Col>
                        </Row>

                        <Row>
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
                                label="Currently studying here"
                                checked={item.is_current || false}
                                onChange={(e) => updateItem(index, "is_current", e.target.checked)}
                            />
                        </Form.Group>

                        <Form.Group className="mb-3">
                            <Form.Label>Description</Form.Label>
                            <Form.Control
                                as="textarea"
                                rows={3}
                                value={item.description || ""}
                                onChange={(e) => updateItem(index, "description", e.target.value)}
                                placeholder="Notable achievements, activities, or coursework..."
                            />
                        </Form.Group>

                        <Button variant="outline-danger" size="sm" onClick={() => removeItem(index)}>
                            <FaTrash /> Remove
                        </Button>
                    </Card.Body>
                </Card>
            ))}
            <Button variant="outline-success" size="sm" onClick={addItem}>
                <FaPlus /> Add Education
            </Button>
        </div>
    );
}