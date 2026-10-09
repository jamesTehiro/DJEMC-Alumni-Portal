import React from "react";
import { Dropdown } from "react-bootstrap";
import { FaPalette } from "react-icons/fa";

export const RESUME_TEMPLATE_OPTIONS = [
    { id: "modern-professional", name: "Modern Professional", description: "Clean, modern design with accent colors" },
    { id: "executive-corporate", name: "Executive Corporate", description: "Traditional corporate layout" },
    { id: "university-green", name: "University Green Theme", description: "DJEMC branded green theme" },
    { id: "minimal-black-white", name: "Minimal Black & White", description: "Clean minimal design" },
    { id: "creative-professional", name: "Creative Professional", description: "Modern creative layout" }
];

export const normalizeTemplateId = (templateId) => {
    if (!templateId) return "university-green";

    const cleaned = String(templateId).trim().toLowerCase();
    const normalized = cleaned.replace(/[_\s]+/g, "-");
    const legacyValues = {
        "modern professional": "modern-professional",
        "executive corporate": "executive-corporate",
        "university green": "university-green",
        "university green theme": "university-green",
        "minimal black white": "minimal-black-white",
        "minimal black & white": "minimal-black-white",
        "creative professional": "creative-professional"
    };

    if (RESUME_TEMPLATE_OPTIONS.some(option => option.id === normalized)) {
        return normalized;
    }
    if (legacyValues[normalized]) {
        return legacyValues[normalized];
    }
    const found = RESUME_TEMPLATE_OPTIONS.find(option => {
        const optionName = option.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
        return optionName === normalized || option.id === normalized || option.id.replace(/-/g, "") === normalized.replace(/-/g, "");
    });
    return found ? found.id : "university-green";
};

export default function TemplateSelector({ currentTemplate, onSelect }) {
    const current = RESUME_TEMPLATE_OPTIONS.find(t => normalizeTemplateId(t.id) === normalizeTemplateId(currentTemplate)) || RESUME_TEMPLATE_OPTIONS[0];

    return (
        <Dropdown>
            <Dropdown.Toggle variant="outline-secondary" size="sm" className="template-selector-btn">
                <FaPalette /> {current.name}
            </Dropdown.Toggle>
            <Dropdown.Menu>
                {RESUME_TEMPLATE_OPTIONS.map(template => (
                    <Dropdown.Item
                        key={template.id}
                        onClick={() => onSelect(template.id)}
                        active={normalizeTemplateId(currentTemplate) === normalizeTemplateId(template.id)}
                    >
                        <div className="template-option">
                            <div className="template-name">{template.name}</div>
                            <div className="template-description">{template.description}</div>
                        </div>
                    </Dropdown.Item>
                ))}
            </Dropdown.Menu>
        </Dropdown>
    );
}