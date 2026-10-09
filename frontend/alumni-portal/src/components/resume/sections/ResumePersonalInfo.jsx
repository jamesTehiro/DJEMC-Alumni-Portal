import React from "react";
import { Form, Button, InputGroup, Row, Col } from "react-bootstrap";
import { FaUser, FaEnvelope, FaPhone, FaMapMarkerAlt } from "react-icons/fa";

export default function ResumePersonalInfo({ data = {}, onChange }) {
    const update = (field, value) => {
        onChange({ ...data, [field]: value });
    };

    return (
        <div className="resume-section personal-info-section">
            <h5>Personal Information</h5>
            <Form.Group className="mb-3">
                <Form.Label>Full Name *</Form.Label>
                <InputGroup>
                    <InputGroup.Text><FaUser /></InputGroup.Text>
                    <Form.Control
                        type="text"
                        value={data.full_name || ""}
                        onChange={(e) => update("full_name", e.target.value)}
                        placeholder="Juan Dela Cruz"
                        required
                    />
                </InputGroup>
            </Form.Group>

            <Form.Group className="mb-3">
                <Form.Label>Professional Title</Form.Label>
                <Form.Control
                    type="text"
                    value={data.professional_title || ""}
                    onChange={(e) => update("professional_title", e.target.value)}
                    placeholder="Senior Software Engineer"
                />
            </Form.Group>

            <Row>
                <Col md={6}>
                    <Form.Group className="mb-3">
                        <Form.Label>Email *</Form.Label>
                        <InputGroup>
                            <InputGroup.Text><FaEnvelope /></InputGroup.Text>
                            <Form.Control
                                type="email"
                                value={data.email || ""}
                                onChange={(e) => update("email", e.target.value)}
                                placeholder="juan@example.com"
                                required
                            />
                        </InputGroup>
                    </Form.Group>
                </Col>
                <Col md={6}>
                    <Form.Group className="mb-3">
                        <Form.Label>Phone</Form.Label>
                        <InputGroup>
                            <InputGroup.Text><FaPhone /></InputGroup.Text>
                            <Form.Control
                                type="tel"
                                value={data.phone || ""}
                                onChange={(e) => update("phone", e.target.value)}
                                placeholder="+63 912 345 6789"
                            />
                        </InputGroup>
                    </Form.Group>
                </Col>
            </Row>

            <Form.Group className="mb-3">
                <Form.Label>Address</Form.Label>
                <InputGroup>
                    <InputGroup.Text><FaMapMarkerAlt /></InputGroup.Text>
                    <Form.Control
                        type="text"
                        value={data.address || ""}
                        onChange={(e) => update("address", e.target.value)}
                        placeholder="Manila, Philippines"
                    />
                </InputGroup>
            </Form.Group>

            <Form.Group className="mb-3">
                <Form.Label>Profile Photo</Form.Label>
                <InputGroup>
                    <Form.Control
                        type="file"
                        accept="image/*"
                        onChange={(e) => {
                            const file = e.target.files[0];
                            if (file) {
                                const reader = new FileReader();
                                reader.onloadend = () => update("photo_url", reader.result);
                                reader.readAsDataURL(file);
                            }
                        }}
                    />
                    {data.photo_url && (
                        <Button variant="outline-danger" onClick={() => update("photo_url", null)}>
                            Remove
                        </Button>
                    )}
                </InputGroup>
                {data.photo_url && (
                    <div className="photo-preview mt-2">
                        <img src={data.photo_url} alt="Profile" className="profile-photo-preview" />
                    </div>
                )}
            </Form.Group>
        </div>
    );
}
