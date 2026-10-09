import React from "react";

export default function SectionHeader({ title, meta }) {
    return (
        <div className="panel-header">
            <h2>{title}</h2>
            <span>{meta}</span>
        </div>
    );
}
