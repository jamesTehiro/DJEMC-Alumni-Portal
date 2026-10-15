import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { resolveFileUrl } from "../../services/api";
import ResumePreviewTemplate from "./templates/ResumePreviewTemplate";
import { A4_HEIGHT_PX, A4_WIDTH_PX, paginateResumeDocument } from "./templates/paginateResumeDocument";
import "./ResumeTemplates.css";

export default function ResumePreview({ resume }) {
    const previewResume = useMemo(() => resume ? { ...resume, personalInfo: { ...resume.personalInfo, photo_url: resolveFileUrl(resume.personalInfo?.photo_url) } } : null, [resume]);
    const containerRef = useRef(null);
    const sourceRef = useRef(null);
    const stageRef = useRef(null);
    const [pages, setPages] = useState([]);
    const [scale, setScale] = useState(1);
    const [previewError, setPreviewError] = useState("");

    useLayoutEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const updateScale = () => setScale(Math.min(1, container.clientWidth / A4_WIDTH_PX));
        updateScale();
        const observer = new ResizeObserver(updateScale);
        observer.observe(container);
        return () => observer.disconnect();
    }, [resume?.id]);

    const updatePages = useCallback(() => {
        if (!resume || !sourceRef.current || !stageRef.current) return;
        const source = sourceRef.current.querySelector(".djemc-resume-document");
        const stage = stageRef.current;
        stage.replaceChildren();
        try {
            const measuredPages = paginateResumeDocument(source, stage);
            setPages(measuredPages.map(page => page.outerHTML));
            setPreviewError("");
        } catch (error) {
            setPreviewError(error.message || "Unable to render this resume. Edit the information and try again.");
            setPages([]);
        } finally { stage.replaceChildren(); }
    }, [resume]);

    useLayoutEffect(updatePages, [updatePages]);

    useEffect(() => {
        let active = true;
        document.fonts?.ready.then(() => {
            if (!active || !resume || !sourceRef.current || !stageRef.current) return;
            updatePages();
        });
        return () => { active = false; };
    }, [resume, updatePages]);

    if (!resume) return <div className="djemc-resume-preview-empty">Select a saved resume to preview it.</div>;

    return (
        <div className="djemc-resume-preview" ref={containerRef}>
            {previewError && <p className="alert alert-danger" role="alert">{previewError}</p>}
            <div className="djemc-resume-measurement" ref={sourceRef} aria-hidden="true"><ResumePreviewTemplate resume={previewResume} /></div>
            <div className="djemc-resume-measurement" ref={stageRef} aria-hidden="true" />
            <div className="djemc-resume-preview-pages">
                {pages.map((html, index) => <div className="djemc-resume-preview-page-shell" key={index} style={{ width: A4_WIDTH_PX * scale, height: A4_HEIGHT_PX * scale, "--resume-preview-scale": scale }} dangerouslySetInnerHTML={{ __html: html }} />)}
            </div>
            <p className="djemc-resume-preview-caption">A4 document · {pages.length} {pages.length === 1 ? "page" : "pages"}</p>
        </div>
    );
}
