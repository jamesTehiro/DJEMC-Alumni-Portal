import React, { useState, useEffect, useCallback, useRef } from "react";
import { Row, Col, Button, Form, InputGroup, Dropdown, Spinner, Alert } from "react-bootstrap";
import { FaSave, FaUndo, FaRedo, FaPrint, FaFilePdf, FaEye, FaCopy, FaPalette, FaFont } from "react-icons/fa";
import { FiMenu, FiX } from "react-icons/fi";
import ResumeEditor from "../components/resume/ResumeEditor";
import ResumePreview from "../components/resume/ResumePreview";
import ResumeScorePanel from "../components/resume/ResumeScorePanel";
import TemplateSelector, { normalizeTemplateId } from "../components/resume/TemplateSelector";
import { api } from "../services/api";
import "./ResumeBuilderPage.css";

const HTML_AMP = "\x26\x61\x6d\x70\x3b";
const HTML_LT = "\x26\x6c\x74\x3b";
const HTML_GT = "\x26\x67\x74\x3b";
const HTML_QUOT = "\x26\x71\x75\x6f\x74\x3b";

export default function ResumeBuilderPage() {
    const [resumes, setResumes] = useState([]);
    const [currentResume, setCurrentResume] = useState(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);
    const [showPreview, setShowPreview] = useState(true);
    const [showScorePanel, setShowScorePanel] = useState(true);
    const [lastSaved, setLastSaved] = useState(null);
    const [completionPercentage, setCompletionPercentage] = useState(0);
    const [undoStack, setUndoStack] = useState([]);
    const [redoStack, setRedoStack] = useState([]);

    const autoSaveTimerRef = useRef(null);
    const previewRef = useRef(null);
    const user = JSON.parse(localStorage.getItem("user") || "{}");

    useEffect(() => {
        loadResumes();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (currentResume) {
            calculateCompletion(currentResume);
        }
    }, [currentResume]);

    const loadResumes = async () => {
        try {
            const response = await api.get("/resumes");
            const resumeList = response.data || [];
            setResumes(resumeList);

            if (resumeList.length > 0) {
                await loadResumeDetail(resumeList[0].id);
            } else {
                // No resumes exist yet. User must explicitly click "+ New Resume" to create one.
                setLoading(false);
            }
        } catch (err) {
            console.error("Failed to load resumes:", err);
            setError("Failed to load resumes. Please try again.");
            setLoading(false);
        }
    };

    const loadResumeDetail = async (resumeId) => {
        try {
            setLoading(true);
            const response = await api.get(`/resumes/${resumeId}`);
            setCurrentResume(response);
            setError(null);
        } catch (err) {
            console.error("Failed to load resume detail:", err);
            setError("Failed to load resume details.");
        } finally {
            setLoading(false);
        }
    };

    const createNewResume = async () => {
        try {
            setLoading(true);
            const response = await api.post("/resumes", {
                title: "My Resume",
                template_id: "modern-professional",
                is_default: true
            });
            await loadResumeDetail(response.data.id);
            return response.data;
        } catch (err) {
            console.error("Failed to create resume:", err);
            setError("Failed to create new resume.");
            setLoading(false);
            throw err;
        }
    };

    const calculateCompletion = (resume) => {
        let total = 0;
        let filled = 0;

        const pi = resume.personalInfo || {};
        total += 20;
        if (pi.full_name) filled += 5;
        if (pi.email) filled += 5;
        if (pi.phone) filled += 5;
        if (pi.address) filled += 5;

        total += 10;
        if (resume.summary?.content) filled += 10;

        total += 15;
        if (resume.education?.length > 0) filled += 15;

        total += 20;
        if (resume.workExperience?.length > 0) filled += 20;

        total += 15;
        if (resume.skills?.length > 0) filled += 15;

        total += 20;
        const otherSections = [
            resume.projects?.length > 0,
            resume.certifications?.length > 0,
            resume.trainings?.length > 0,
            resume.seminars?.length > 0,
            resume.awards?.length > 0,
            resume.organizations?.length > 0,
            resume.volunteerWork?.length > 0,
            resume.languages?.length > 0,
            resume.references?.length > 0
        ];
        const filledSections = otherSections.filter(Boolean).length;
        filled += (filledSections / otherSections.length) * 20;

        const percentage = Math.round((filled / total) * 100);
        setCompletionPercentage(percentage);
    };

    const autoSave = useCallback(async (resumeData) => {
        if (autoSaveTimerRef.current) {
            clearTimeout(autoSaveTimerRef.current);
        }

        autoSaveTimerRef.current = setTimeout(async () => {
            await saveResume(resumeData, true);
        }, 2000);
    }, []);

    const saveResume = async (resumeData, isAutoSave = false) => {
        if (!resumeData?.id) return;

        try {
            setSaving(true);
            const { id, ...updateData } = resumeData;

            await api.put(`/resumes/${id}`, updateData);

            setLastSaved(new Date());
            setUndoStack(prev => [...prev, resumeData]);
            setRedoStack([]);
        } catch (err) {
            console.error("Failed to save resume:", err);
            if (!isAutoSave) {
                setError("Failed to save resume. Please try again.");
            }
        } finally {
            setSaving(false);
        }
    };

    const handleUndo = () => {
        if (undoStack.length === 0) return;
        const current = undoStack[undoStack.length - 1];
        setRedoStack(prev => [...prev, current]);
        setUndoStack(prev => prev.slice(0, -1));
    };

    const handleRedo = () => {
        if (redoStack.length === 0) return;
        const next = redoStack[redoStack.length - 1];
        setUndoStack(prev => [...prev, next]);
        setRedoStack(prev => prev.slice(0, -1));
    };

    const handleDuplicate = async () => {
        if (!currentResume?.id) return;
        try {
            const response = await api.post(`/resumes/${currentResume.id}/duplicate`);
            await loadResumes();
            await loadResumeDetail(response.data.id);
        } catch (err) {
            console.error("Failed to duplicate resume:", err);
            setError("Failed to duplicate resume.");
        }
    };

    const escapeHtmlEntity = (text) => {
        if (!text) return '';
        return String(text)
            .replace(/&/g, HTML_AMP)
            .replace(/</g, HTML_LT)
            .replace(/>/g, HTML_GT)
            .replace(/"/g, HTML_QUOT);
    };

    const renderSectionHtml = (title, items, headerFields, detailFields, descField) => {
        if (!items || items.length === 0) return '';
        let html = '<div class="section-title">' + title + '</div>';
        items.forEach(item => {
            const header = headerFields.map(f => item[f]).filter(Boolean).join(' - ');
            const details = detailFields.map(f => {
                const val = item[f];
                return val ? formatDate(val) : '';
            }).filter(Boolean).join(' | ');
            const desc = descField ? (item[descField] || '') : '';

            html += '<div class="entry">';
            if (header) html += '<div class="entry-header">' + escapeHtmlEntity(header) + '</div>';
            if (details) html += '<div class="entry-details">' + escapeHtmlEntity(details) + '</div>';
            if (desc) html += '<div class="entry-description">' + escapeHtmlEntity(desc) + '</div>';
            html += '</div>';
        });
        return html;
    };

    const renderSkillsHtml = (skills) => {
        if (!skills || skills.length === 0) return '';
        let html = '<div class="section-title">Skills</div><div class="skills-list">';
        skills.forEach(s => {
            html += '<span class="skill-item">' + escapeHtmlEntity(s.name || '') + (s.level ? ' - ' + s.level : '') + '</span>';
        });
        html += '</div>';
        return html;
    };

    const renderLanguagesHtml = (languages) => {
        if (!languages || languages.length === 0) return '';
        let html = '<div class="section-title">Languages</div><ul>';
        languages.forEach(l => {
            html += '<li>' + escapeHtmlEntity(l.name || '') + (l.proficiency ? ' - ' + l.proficiency : '') + '</li>';
        });
        html += '</ul>';
        return html;
    };

    const formatDate = (dateStr) => {
        if (!dateStr) return '';
        try {
            const d = new Date(dateStr);
            if (!isNaN(d.getTime())) {
                return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
            }
        } catch { }
        return dateStr;
    };

    const buildPrintHtml = () => {
        const resume = currentResume;
        if (!resume) return '';

        const pi = resume.personalInfo || {};
        const summary = resume.summary || {};
        const fontSize = resume.font_size || 11;
        const fontFamily = resume.font_family || 'Inter, Arial, sans-serif';
        const lineSpacing = resume.line_spacing || 1.5;
        const colorTheme = resume.color_theme || '#155a43';

        const headerName = pi.full_name ? '<h1>' + escapeHtmlEntity(pi.full_name) + '</h1>' : '';
        let contactInfo = '';
        if (pi.email) contactInfo += escapeHtmlEntity(pi.email);
        if (pi.phone) contactInfo += (contactInfo ? ' | ' : '') + escapeHtmlEntity(pi.phone);
        if (pi.address) contactInfo += '<br>' + escapeHtmlEntity(pi.address);
        const contactSection = contactInfo ? '<div class="contact-info">' + contactInfo + '</div>' : '';

        const summarySection = summary.content
            ? '<div class="section-title">Professional Summary</div><div class="summary-content">' + escapeHtmlEntity(summary.content) + '</div>'
            : '';

        return '<!DOCTYPE html><html><head><title>' + (resume.title || 'Resume') + ' - Print</title>'
            + '<style>'
            + '@page { margin: 0.5in; size: A4; }'
            + '* { box-sizing: border-box; margin: 0; padding: 0; }'
            + 'body { font-family: ' + fontFamily + '; font-size: ' + fontSize + 'pt; line-height: ' + lineSpacing + '; color: #333; padding: 20px; background: #fff; }'
            + '.resume-header { text-align: center; margin-bottom: 20px; border-bottom: 2px solid ' + colorTheme + '; padding-bottom: 15px; }'
            + '.resume-header h1 { font-size: ' + (fontSize + 8) + 'pt; color: ' + colorTheme + '; margin-bottom: 5px; }'
            + '.resume-header .contact-info { font-size: ' + fontSize + 'pt; color: #555; }'
            + '.section-title { font-size: ' + (fontSize + 2) + 'pt; color: ' + colorTheme + '; border-bottom: 1px solid #ddd; padding-bottom: 5px; margin-top: 15px; margin-bottom: 10px; text-transform: uppercase; font-weight: bold; }'
            + '.entry { margin-bottom: 10px; }'
            + '.entry-header { display: flex; justify-content: space-between; font-weight: bold; }'
            + '.entry-details { color: #555; font-style: italic; }'
            + '.entry-description { margin-top: 3px; white-space: pre-wrap; }'
            + '.skills-list { display: flex; flex-wrap: wrap; gap: 5px; }'
            + '.skill-item { background: #f5f5f5; padding: 2px 8px; border-radius: 3px; font-size: ' + (fontSize - 1) + 'pt; }'
            + '.summary-content { white-space: pre-wrap; margin-bottom: 10px; }'
            + 'ul { padding-left: 20px; } li { margin-bottom: 3px; }'
            + '@media print { body { padding: 0; } }'
            + '</style></head><body>'
            + '<div class="resume-header">' + headerName + contactSection + '</div>'
            + summarySection
            + renderSectionHtml('Education', resume.education, ['degree', 'school'], ['field_of_study', 'start_date', 'end_date'], 'description')
            + renderSectionHtml('Work Experience', resume.workExperience, ['job_title', 'company'], ['location', 'start_date', 'end_date'], 'description')
            + renderSkillsHtml(resume.skills)
            + renderSectionHtml('Projects', resume.projects, ['name'], ['start_date', 'end_date'], 'description')
            + renderSectionHtml('Certifications', resume.certifications, ['name', 'issuer'], ['date'], 'description')
            + renderSectionHtml('Trainings', resume.trainings, ['title', 'provider'], ['start_date', 'end_date'], 'description')
            + renderSectionHtml('Seminars', resume.seminars, ['title', 'organizer'], ['date'], 'description')
            + renderSectionHtml('Awards', resume.awards, ['title', 'issuer'], ['date'], 'description')
            + renderSectionHtml('Organizations', resume.organizations, ['name', 'role'], ['start_date', 'end_date'], 'description')
            + renderSectionHtml('Volunteer Work', resume.volunteerWork, ['organization', 'role'], ['start_date', 'end_date'], 'description')
            + renderLanguagesHtml(resume.languages)
            + renderSectionHtml('References', resume.references, ['name', 'position', 'company'], ['email', 'phone'], null)
            + '</body></html>';
    };

    const handlePrint = () => {
        const printWindow = window.open('', '_blank', 'width=800,height=600');
        if (!printWindow) {
            window.print();
            return;
        }

        printWindow.document.write(buildPrintHtml());
        printWindow.document.close();

        setTimeout(() => {
            printWindow.focus();
            printWindow.print();
        }, 500);
    };

    const handleDownloadPDF = async () => {
        handlePrint();
    };

    const handleResumeDataChange = (updatedData) => {
        setCurrentResume(prev => {
            const next = { ...prev, ...updatedData };
            autoSave(next);
            return next;
        });
    };

    if (loading && !currentResume) {
        return (
            <div className="resume-builder-loading">
                <Spinner animation="border" variant="success" />
                <p>Loading Resume Builder...</p>
            </div>
        );
    }

    return (
        <div className="resume-builder-page">
            <div className="resume-builder-toolbar">
                <div className="toolbar-left">
                    <Dropdown>
                        <Dropdown.Toggle variant="success" size="sm" className="toolbar-btn">
                            <FaFilePdf /> {currentResume?.title || "My Resume"}
                        </Dropdown.Toggle>
                        <Dropdown.Menu>
                            {resumes.map(resume => (
                                <Dropdown.Item
                                    key={resume.id}
                                    onClick={() => loadResumeDetail(resume.id)}
                                    active={currentResume?.id === resume.id}
                                >
                                    {resume.personalInfo?.full_name || resume.title}
                                </Dropdown.Item>
                            ))}
                            <Dropdown.Divider />
                            <Dropdown.Item onClick={createNewResume}>
                                + New Resume
                            </Dropdown.Item>
                        </Dropdown.Menu>
                    </Dropdown>

                    <Button variant="outline-secondary" size="sm" onClick={handleUndo} disabled={undoStack.length === 0}>
                        <FaUndo />
                    </Button>
                    <Button variant="outline-secondary" size="sm" onClick={handleRedo} disabled={redoStack.length === 0}>
                        <FaRedo />
                    </Button>

                    <div className="toolbar-divider" />

                    {saving && <Spinner animation="border" size="sm" />}
                    <span className="last-saved">
                        {lastSaved ? `Saved ${lastSaved.toLocaleTimeString()}` : "Not saved"}
                    </span>
                </div>

                <div className="toolbar-center">
                    <Button variant="outline-primary" size="sm" onClick={() => setShowPreview(!showPreview)}>
                        <FaEye /> {showPreview ? "Hide" : "Show"} Preview
                    </Button>
                    <Button variant="outline-primary" size="sm" onClick={() => setShowScorePanel(!showScorePanel)}>
                        Score: {completionPercentage}%
                    </Button>
                </div>

                <div className="toolbar-right">
                    <TemplateSelector
                        currentTemplate={currentResume?.template_id}
                        onSelect={async (template) => {
                            await handleResumeDataChange({ template_id: template });
                        }}
                    />

                    <Button variant="success" size="sm" onClick={() => saveResume(currentResume)} disabled={saving}>
                        <FaSave /> Save
                    </Button>
                    <Button variant="outline-secondary" size="sm" onClick={handleDuplicate}>
                        <FaCopy />
                    </Button>
                    <Button variant="outline-secondary" size="sm" onClick={handlePrint}>
                        <FaPrint />
                    </Button>
                    <Button variant="success" size="sm" onClick={handleDownloadPDF}>
                        <FaFilePdf /> PDF
                    </Button>
                </div>
            </div>

            {error && (
                <Alert variant="danger" dismissible onClose={() => setError(null)} className="resume-error">
                    {error}
                </Alert>
            )}

            <div className="resume-builder-content">
                <Row className="h-100">
                    <Col md={showScorePanel ? 7 : 8} className={`editor-section ${showPreview ? "with-preview" : ""}`}>
                        {currentResume && (
                            <ResumeEditor
                                resume={currentResume}
                                onChange={handleResumeDataChange}
                            />
                        )}
                    </Col>

                    {showPreview && (
                        <Col md={showScorePanel ? 5 : 4} className="preview-section">
                            <div className="preview-container" ref={previewRef}>
                                <ResumePreview resume={currentResume} />
                            </div>
                        </Col>
                    )}

                    {showScorePanel && (
                        <Col md={showPreview ? 0 : 5} className="score-section">
                            <ResumeScorePanel resume={currentResume} />
                        </Col>
                    )}
                </Row>
            </div>
        </div>
    );
}
