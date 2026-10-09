import React from "react";
import ResumePreviewTemplate from "./templates/ResumePreviewTemplate";

export default function ResumePreview({ resume }) {
    if (!resume) return <div className="preview-empty">No resume selected</div>;

    return (
        <div className="resume-preview">
            <div className="a4-page">
                <ResumePreviewTemplate resume={resume} />
            </div>
        </div>
    );
}