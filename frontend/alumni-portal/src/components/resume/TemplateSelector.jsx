import React, { useLayoutEffect, useRef, useState } from "react";
import { FaCheckCircle } from "react-icons/fa";
import ResumePreviewTemplate from "./templates/ResumePreviewTemplate";
import { RESUME_TEMPLATE_OPTIONS, RESUME_TEMPLATE_SAMPLE, normalizeTemplateId } from "./templates/resumeTemplateConfig";
import { createResumeSections } from "./templates/resumeTemplateData";
import { A4_WIDTH_PX } from "./templates/paginateResumeDocument";
import "./ResumeTemplates.css";
import "./TemplateSelector.css";
import { resolveFileUrl } from "../../services/api";

export { RESUME_TEMPLATE_OPTIONS, normalizeTemplateId } from "./templates/resumeTemplateConfig";

function TemplateThumbnail({ resume, templateId }) {
    const containerRef = useRef(null);
    const [scale, setScale] = useState(0.3);
    useLayoutEffect(() => {
        const container = containerRef.current;
        const resize = () => setScale(container.clientWidth / A4_WIDTH_PX);
        resize();
        const observer = new ResizeObserver(resize);
        observer.observe(container);
        return () => observer.disconnect();
    }, []);
    return (
        <div className="djemc-template-thumbnail" ref={containerRef} aria-hidden="true" style={{ "--template-thumbnail-scale": scale }}>
            <ResumePreviewTemplate resume={{ ...resume, template_id: templateId, personalInfo: { ...resume.personalInfo, photo_url: resolveFileUrl(resume.personalInfo?.photo_url) } }} />
        </div>
    );
}

export default function TemplateSelector({ currentTemplate, onSelect, resume }) {
    const selected = normalizeTemplateId(currentTemplate);
    const previewResume = resume && createResumeSections(resume).length ? resume : RESUME_TEMPLATE_SAMPLE;
    const handleKeyDown = (event, index) => {
        const directions = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
        let nextIndex;
        if (event.key === "Home") nextIndex = 0;
        else if (event.key === "End") nextIndex = RESUME_TEMPLATE_OPTIONS.length - 1;
        else if (directions[event.key]) nextIndex = (index + directions[event.key] + RESUME_TEMPLATE_OPTIONS.length) % RESUME_TEMPLATE_OPTIONS.length;
        else return;
        event.preventDefault();
        onSelect(RESUME_TEMPLATE_OPTIONS[nextIndex].id);
        event.currentTarget.parentElement.children[nextIndex]?.focus();
    };

    return (
        <div className="djemc-template-gallery" role="radiogroup" aria-label="Choose a resume template">
            {RESUME_TEMPLATE_OPTIONS.map((template, index) => {
                const isSelected = selected === template.id;
                return (
                    <button type="button" className={`djemc-template-card${isSelected ? " is-selected" : ""}`} key={template.id} role="radio" aria-checked={isSelected} aria-label={`${template.name}. ${template.description}`} tabIndex={isSelected ? 0 : -1} onClick={() => onSelect(template.id)} onKeyDown={event => handleKeyDown(event, index)}>
                        <div className="djemc-template-thumbnail-frame">
                            <TemplateThumbnail resume={previewResume} templateId={template.id} />
                            {isSelected && <span className="djemc-template-selected-badge"><FaCheckCircle /> Selected</span>}
                        </div>
                        <div className="djemc-template-card-copy">
                            <span className="djemc-template-name">{template.name}</span>
                            <span className="djemc-template-layout">{template.layout}</span>
                            <span className="djemc-template-description">{template.description}</span>
                            <span className="djemc-template-select-label">{isSelected ? "Selected Template" : "Select Template"}</span>
                        </div>
                    </button>
                );
            })}
        </div>
    );
}
