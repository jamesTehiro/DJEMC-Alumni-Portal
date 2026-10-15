import React from "react";
import { Form, Button, Row, Col } from "react-bootstrap";
import { FaUsers, FaPlus, FaTrash } from "react-icons/fa";

export default function ResumeOrganizations({ items = [], onChange }) {
    const addItem = () => {
        onChange([...items, { organization_name: "", position: "", start_date: "", end_date: "", is_current: false, description: "" }]);
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
        <div className="resume-section organizations-section">
            <h5>Organizations</h5>
            {items.map((item, index) => (
                <div key={index} className="item-card mb-3 p-3 border rounded">
                    <Row>
                        <Col md={6}>
                            <Form.Group className="mb-3">
                                <Form.Label>Organization Name</Form.Label>
                                <Form.Control type="text" value={item.organization_name ?? item.name ?? ""} onChange={(e) => updateItem(index, "organization_name", e.target.value)} placeholder="Professional Engineers Society" />
                            </Form.Group>
                        </Col>
                        <Col md={6}>
                            <Form.Group className="mb-3">
                                <Form.Label>Position</Form.Label>
                                <Form.Control type="text" value={item.position || ""} onChange={(e) => updateItem(index, "position", e.target.value)} placeholder="Member" />
                            </Form.Group>
                        </Col>
                    </Row>
                    <Button variant="outline-danger" size="sm" onClick={() => removeItem(index)}><FaTrash /> Remove</Button>
                </div>
            ))}
            <Button variant="outline-success" size="sm" onClick={addItem}><FaPlus /> Add Organization</Button>
        </div>
    );
}
