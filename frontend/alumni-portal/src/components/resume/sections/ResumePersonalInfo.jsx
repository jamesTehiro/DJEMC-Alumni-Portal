import React, { useEffect, useRef, useState } from "react";
import { Form, Button, InputGroup, Row, Col } from "react-bootstrap";
import { FaUser, FaEnvelope, FaPhone, FaMapMarkerAlt } from "react-icons/fa";
import { resolveFileUrl } from "../../../services/api";

export default function ResumePersonalInfo({ data = {}, onChange, errors = {}, onBusyChange }) {
    const fileInputRef = useRef(null);
    const photoSelectionRef = useRef(0);
    const photoObjectUrlRef = useRef(null);
    const [photoError, setPhotoError] = useState("");
    const latestDataRef = useRef(data);
    const latestChangeRef = useRef(onChange);
    latestDataRef.current = data;
    latestChangeRef.current = onChange;

    useEffect(() => () => {
        photoSelectionRef.current += 1;
        if (photoObjectUrlRef.current) URL.revokeObjectURL(photoObjectUrlRef.current);
        onBusyChange?.(false);
    }, []);

    const update = (field, value) => {
        latestChangeRef.current({ ...latestDataRef.current, [field]: value });
    };

    const readResumePhoto = (file) => new Promise((resolve, reject) => {
        const imageUrl = URL.createObjectURL(file);
        if (photoObjectUrlRef.current) URL.revokeObjectURL(photoObjectUrlRef.current);
        photoObjectUrlRef.current = imageUrl;
        const image = new Image();
        image.onload = () => {
            URL.revokeObjectURL(imageUrl);
            if (photoObjectUrlRef.current === imageUrl) photoObjectUrlRef.current = null;
            const maxDataUrlLength = 60000;
            let maxDimension = 420;
            try {
                for (let resizeAttempt = 0; resizeAttempt < 6; resizeAttempt += 1) {
                    const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
                    const canvas = document.createElement("canvas");
                    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
                    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
                    const context = canvas.getContext("2d");
                    if (!context) throw new Error("Image processing is unavailable in this browser.");
                    context.fillStyle = "#ffffff";
                    context.fillRect(0, 0, canvas.width, canvas.height);
                    context.drawImage(image, 0, 0, canvas.width, canvas.height);

                    for (const quality of [0.78, 0.68, 0.58, 0.48]) {
                        const dataUrl = canvas.toDataURL("image/jpeg", quality);
                        if (dataUrl.length <= maxDataUrlLength) {
                            resolve(dataUrl);
                            return;
                        }
                    }
                    maxDimension = Math.round(maxDimension * 0.78);
                }
                reject(new Error("This photo could not be reduced to a size that can be saved. Try a smaller image."));
            } catch (error) {
                reject(error);
            }
        };
        image.onerror = () => {
            URL.revokeObjectURL(imageUrl);
            if (photoObjectUrlRef.current === imageUrl) photoObjectUrlRef.current = null;
            reject(new Error("This image could not be opened. Choose a JPG or PNG file."));
        };
        image.src = imageUrl;
    });

    const handlePhotoChange = async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        const selectionId = ++photoSelectionRef.current;
        setPhotoError("");
        onBusyChange?.(true);
        try {
            const photoUrl = await readResumePhoto(file);
            if (selectionId === photoSelectionRef.current) update("photo_url", photoUrl);
        } catch (error) {
            if (selectionId === photoSelectionRef.current) setPhotoError(error.message);
        } finally {
            if (selectionId === photoSelectionRef.current) onBusyChange?.(false);
        }
    };

    const removePhoto = () => {
        photoSelectionRef.current += 1;
        if (photoObjectUrlRef.current) URL.revokeObjectURL(photoObjectUrlRef.current);
        photoObjectUrlRef.current = null;
        update("photo_url", null);
        setPhotoError("");
        if (fileInputRef.current) fileInputRef.current.value = "";
    };

    return (
        <div className="resume-section personal-info-section">
            <h5>Personal Information</h5>
            <Form.Group className="mb-3" controlId="resume-full-name">
                <Form.Label>Full Name *</Form.Label>
                <InputGroup>
                    <InputGroup.Text><FaUser /></InputGroup.Text>
                    <Form.Control
                        type="text"
                        value={data.full_name || ""}
                        maxLength={255}
                        onChange={(e) => update("full_name", e.target.value)}
                        placeholder="Juan Dela Cruz"
                        required
                        isInvalid={Boolean(errors.full_name)}
                        aria-describedby={errors.full_name ? "resume-full-name-error" : undefined}
                    />
                    <Form.Control.Feedback type="invalid" id="resume-full-name-error">{errors.full_name}</Form.Control.Feedback>
                </InputGroup>
            </Form.Group>

            <Form.Group className="mb-3">
                <Form.Label>Professional Title</Form.Label>
                <Form.Control
                    type="text"
                    value={data.professional_title || ""}
                    maxLength={255}
                    onChange={(e) => update("professional_title", e.target.value)}
                    placeholder="Senior Software Engineer"
                />
            </Form.Group>

            <Row>
                <Col md={6}>
                    <Form.Group className="mb-3" controlId="resume-email">
                        <Form.Label>Email *</Form.Label>
                        <InputGroup>
                            <InputGroup.Text><FaEnvelope /></InputGroup.Text>
                            <Form.Control
                                type="email"
                                maxLength={255}
                                value={data.email || ""}
                                onChange={(e) => update("email", e.target.value)}
                                placeholder="juan@example.com"
                                required
                                isInvalid={Boolean(errors.email)}
                                aria-describedby={errors.email ? "resume-email-error" : undefined}
                            />
                            <Form.Control.Feedback type="invalid" id="resume-email-error">{errors.email}</Form.Control.Feedback>
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
                                maxLength={50}
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
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handlePhotoChange}
                    />
                    {data.photo_url && (
                        <Button type="button" variant="outline-danger" onClick={removePhoto}>
                            Remove
                        </Button>
                    )}
                </InputGroup>
                {photoError && <Form.Text className="text-danger">{photoError}</Form.Text>}
                {data.photo_url && (
                    <div className="photo-preview mt-2">
                        <img src={resolveFileUrl(data.photo_url)} alt="Profile" className="profile-photo-preview" />
                    </div>
                )}
            </Form.Group>
        </div>
    );
}
