import React from "react";
import { Form } from "react-bootstrap";

export default function AlumniSearchBar({ value, onChange, disabled = false }) {
    return (
        <Form.Control
            className="saas-input"
            placeholder={
                disabled
                    ? "Search disabled while adding record..."
                    : "Search full name..."
            }
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
        />
    );
}
