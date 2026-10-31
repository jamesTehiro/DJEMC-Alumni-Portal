import React, { useId } from "react";

// The same document and information field controls used by the posting workflow.
export default function JobRequirementsEditor({ value, onChange }) {
    const id = useId();
    const update = (index, field, next) => onChange(items => items.map((item, i) => i === index ? {
        ...item, [field]: next,
        ...(field === "requirement_type" ? { value_type: next === "document_upload" ? "file" : "text" } : {})
    } : item));
    return <div className="job-requirements-editor">
        {value.map((item, index) => <div className="job-requirements-item" key={item.requirement_code}>
            <div className="job-posting-field-grid">
                <div className="job-posting-field"><label htmlFor={`${id}-label-${index}`}>Label</label><input id={`${id}-label-${index}`} value={item.label || ""} maxLength={255} onChange={event => update(index, "label", event.target.value)} /></div>
                <div className="job-posting-field"><label htmlFor={`${id}-type-${index}`}>Type</label><select id={`${id}-type-${index}`} value={item.requirement_type} onChange={event => update(index, "requirement_type", event.target.value)}><option value="document_upload">Document Upload</option><option value="information_field">Information Field</option></select></div>
                {item.requirement_type === "information_field" && <div className="job-posting-field"><label htmlFor={`${id}-input-${index}`}>Input Type</label><select id={`${id}-input-${index}`} value={item.value_type || "text"} onChange={event => update(index, "value_type", event.target.value)}>{[...new Set(["text", "textarea", "number", "date", item.value_type].filter(Boolean))].map(type => <option key={type} value={type}>{type}</option>)}</select></div>}
                {item.requirement_type === "document_upload" && <div className="job-posting-field"><label htmlFor={`${id}-allowed-${index}`}>Allowed Types</label><input id={`${id}-allowed-${index}`} value={Array.isArray(item.allowed_types) ? item.allowed_types.join(",") : item.allowed_types || ""} onChange={event => update(index, "allowed_types", event.target.value)} placeholder="pdf,doc,docx,png,jpg" /></div>}
            </div>
            <div className="job-requirements-actions"><label className="job-posting-contact-choice"><input type="checkbox" checked={item.required !== false} onChange={event => update(index, "required", event.target.checked)} />Required</label><button type="button" className="job-posting-remove" onClick={() => onChange(items => items.filter((_, i) => i !== index))} aria-label={`Remove application requirement ${index + 1}`}>Remove</button></div>
        </div>)}
        <button type="button" className="job-posting-outline" disabled={value.length >= 100} onClick={() => onChange(items => [...items, {
            requirement_code: `custom_${crypto.randomUUID()}`, label: "", requirement_type: "document_upload", value_type: "file", required: true, is_custom: true, sort_order: items.length
        }])}>+ Custom Requirement</button>
    </div>;
}
