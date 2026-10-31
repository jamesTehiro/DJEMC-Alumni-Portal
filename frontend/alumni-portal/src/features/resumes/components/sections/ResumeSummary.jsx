import React from "react";
import { Form } from "react-bootstrap";

export default function ResumeSummary({ data = {}, onChange }) {
    const update = (field, value) => {
        onChange({ ...data, [field]: value });
    };

    return (
        <div className="resume-section summary-section">
            <h5>Professional Summary</h5>
            <Form.Group>
                <Form.Label>Summary</Form.Label>
                <Form.Control
                    as="textarea"
                    rows={6}
                    value={data.content || ""}
                    onChange={(e) => update("content", e.target.value)}
                    placeholder="Write a compelling professional summary that highlights your key qualifications, experience, and career objectives..."
                />
                <Form.Text className="text-muted">
                    {data.content?.length || 0} characters
                </Form.Text>
            </Form.Group>
        </div>
    );
}