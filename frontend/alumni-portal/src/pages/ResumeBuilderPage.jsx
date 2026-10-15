import React, { useEffect, useRef, useState } from "react";
import { Alert, Button, Dropdown, Form, Spinner } from "react-bootstrap";
import { FaArrowLeft, FaArrowRight, FaCheck, FaCopy, FaFilePdf, FaPlus, FaPrint, FaRedo, FaSave, FaUndo } from "react-icons/fa";
import ResumeEditor from "../components/resume/ResumeEditor";
import ResumePreview from "../components/resume/ResumePreview";
import ResumeScorePanel from "../components/resume/ResumeScorePanel";
import TemplateSelector, { RESUME_TEMPLATE_OPTIONS } from "../components/resume/TemplateSelector";
import { buildResumeDocumentHtml } from "../components/resume/templates/resumeDocumentExport";
import { api } from "../services/api";
import { createResumeDraft, normalizeResume, persistResume, restoreResumeDraft, resumeCompletion,
    resumeFingerprint, unwrapResume, unwrapResumeList, validateResume } from "../utils/resumeWorkflow";
import "./ResumeBuilderPage.css";

const steps = ["Resume Information", "Choose Template", "Preview & Download"];
const newDraftId = () => globalThis.crypto?.randomUUID?.() || `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const readUser = () => { try { return JSON.parse(localStorage.getItem("user") || "{}"); } catch { return {}; } };

export default function ResumeBuilderPage() {
    const [user] = useState(readUser);
    const [resumes, setResumes] = useState([]);
    const [currentResume, setCurrentResume] = useState(null);
    const [savedResume, setSavedResume] = useState(null);
    const [step, setStep] = useState(1);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [photoBusy, setPhotoBusy] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [cacheWarning, setCacheWarning] = useState("");
    const [fieldErrors, setFieldErrors] = useState({});
    const [undoStack, setUndoStack] = useState([]);
    const [redoStack, setRedoStack] = useState([]);
    const [reloadKey, setReloadKey] = useState(0);
    const currentRef = useRef(null);
    const profileRef = useRef(user);
    const busyRef = useRef(false);
    const cacheKey = `djemc:resume-builder:${user.id || "current-user"}`;
    const dirty = Boolean(currentResume && (!savedResume || resumeFingerprint(currentResume) !== resumeFingerprint(savedResume)));
    const busy = loading || saving || exporting || photoBusy;
    const selectedTemplate = RESUME_TEMPLATE_OPTIONS.find(template => template.id === (step === 3 ? savedResume : currentResume)?.template_id);
    const replaceDraft = (resume) => { currentRef.current = resume; setCurrentResume(resume); };

    useEffect(() => {
        let cancelled = false;
        const initialize = async () => {
            setLoading(true);
            setError("");
            try {
                const [listResult, profileResult] = await Promise.allSettled([api.get("/resumes", true), api.get("/profile", true)]);
                if (listResult.status === "rejected") throw listResult.reason;
                const list = unwrapResumeList(listResult.value);
                const profile = profileResult.status === "fulfilled" ? profileResult.value : user;
                if (cancelled) return;
                profileRef.current = profile;
                setResumes(list);
                let cached = null;
                try { if (user.id) cached = restoreResumeDraft(sessionStorage.getItem(cacheKey), user.id, list); } catch { /* Storage may be disabled. */ }
                const recordId = cached?.id || list[0]?.id;
                const persisted = recordId ? unwrapResume(await api.get(`/resumes/${recordId}`, true)) : null;
                if (cancelled) return;
                const next = cached || persisted || createResumeDraft(profile, newDraftId());
                currentRef.current = next;
                setCurrentResume(next);
                setSavedResume(persisted);
                setStep(cached || !persisted ? 1 : 3);
                setUndoStack([]);
                setRedoStack([]);
                if (cached) setNotice("Your unsaved changes were restored. Save when you are ready.");
                else if (profileResult.status === "rejected") setNotice("Profile prefill is unavailable. You can enter your information below.");
            } catch (err) {
                if (!cancelled) setError(err.message || "Unable to load your resumes. Please try again.");
            } finally { if (!cancelled) setLoading(false); }
        };
        initialize();
        return () => { cancelled = true; };
    }, [cacheKey, reloadKey, user]);

    useEffect(() => {
        if (loading || !currentResume || !user.id) return;
        try {
            if (dirty) sessionStorage.setItem(cacheKey, JSON.stringify({ version: 1, userId: user.id, resume: currentResume }));
            else sessionStorage.removeItem(cacheKey);
            setCacheWarning("");
        } catch { setCacheWarning("This browser could not keep a local draft. Save your changes before leaving the page."); }
    }, [cacheKey, currentResume, dirty, loading, user.id]);

    useEffect(() => {
        if (!dirty) return;
        const warn = (event) => { event.preventDefault(); event.returnValue = ""; };
        window.addEventListener("beforeunload", warn);
        return () => window.removeEventListener("beforeunload", warn);
    }, [dirty]);
    useEffect(() => {
        const headings = ["resume-information-title", "resume-template-title", "resume-preview-title"];
        document.getElementById(headings[step - 1])?.focus({ preventScroll: true });
    }, [step]);

    const changeDraft = (patch) => {
        const previous = currentRef.current;
        if (!previous || busyRef.current) return;
        const next = normalizeResume({ ...previous, ...patch });
        setUndoStack(stack => [...stack.slice(-39), previous]);
        setRedoStack([]);
        replaceDraft(next);
        setNotice("");
        if (patch.personalInfo && Object.keys(fieldErrors).length) setFieldErrors(validateResume(next));
    };
    const discardConfirmed = () => !dirty || window.confirm("You have unsaved changes. Discard them and open another resume?");
    const startNewResume = () => {
        if (busy || !discardConfirmed()) return;
        replaceDraft(createResumeDraft(profileRef.current, newDraftId()));
        setSavedResume(null); setStep(1); setUndoStack([]); setRedoStack([]);
        setFieldErrors({}); setError(""); setNotice("");
    };
    const openResume = async (id) => {
        if (busy || (String(id) !== String(currentRef.current?.id) && !discardConfirmed())) return;
        if (String(id) === String(currentRef.current?.id)) { setStep(dirty ? 1 : 3); return; }
        setLoading(true); setError("");
        try {
            const resume = unwrapResume(await api.get(`/resumes/${id}`, true));
            replaceDraft(resume); setSavedResume(resume); setStep(3);
            setUndoStack([]); setRedoStack([]); setFieldErrors({}); setNotice("");
        } catch (err) { setError(err.message || "Unable to open this resume."); }
        finally { setLoading(false); }
    };
    const validate = () => {
        const errors = validateResume(currentRef.current);
        setFieldErrors(errors);
        if (Object.keys(errors).length) {
            setError("Complete the required personal information to continue."); setStep(1); return false;
        }
        setError(""); return true;
    };
    const saveResume = async (generate = false) => {
        if (busyRef.current || busy || !validate()) return;
        busyRef.current = true; setSaving(true); setNotice("");
        try {
            const saved = await persistResume({ api, resume: currentRef.current,
                onIdentified: (id) => replaceDraft({ ...currentRef.current, id }) });
            replaceDraft(saved); setSavedResume(saved);
            setResumes(list => [saved, ...list.filter(item => String(item.id) !== String(saved.id))]);
            setUndoStack([]); setRedoStack([]);
            setNotice(generate ? "Resume saved. Your preview and PDF use this saved version." : "Resume saved.");
            if (generate) setStep(3);
        } catch (err) { setError(err.message || "Your resume could not be saved. Your changes are still available to retry."); }
        finally { busyRef.current = false; setSaving(false); }
    };
    const duplicateResume = async () => {
        if (!savedResume?.id || busy || busyRef.current || !discardConfirmed()) return;
        busyRef.current = true; setSaving(true); setError("");
        let copyCreated = false;
        try {
            const created = unwrapResume(await api.post(`/resumes/${savedResume.id}/duplicate`, {}, true));
            copyCreated = true;
            setResumes(list => [created, ...list]);
            const duplicate = unwrapResume(await api.get(`/resumes/${created.id}`, true));
            replaceDraft(duplicate); setSavedResume(duplicate); setStep(3);
            setUndoStack([]); setRedoStack([]); setNotice("A copy of your saved resume was created.");
        } catch (err) { setError(copyCreated ? "The copy was created, but could not be opened. Select it from My Resumes to try again." : (err.message || "Unable to create a copy. Your original resume is still open.")); }
        finally { busyRef.current = false; setSaving(false); }
    };
    const undo = () => {
        if (!undoStack.length || busy) return;
        setRedoStack(stack => [...stack.slice(-39), currentRef.current]);
        replaceDraft(undoStack[undoStack.length - 1]); setUndoStack(stack => stack.slice(0, -1));
    };
    const redo = () => {
        if (!redoStack.length || busy) return;
        setUndoStack(stack => [...stack.slice(-39), currentRef.current]);
        replaceDraft(redoStack[redoStack.length - 1]); setRedoStack(stack => stack.slice(0, -1));
    };
    const downloadPdf = async () => {
        if (!savedResume?.id || busy || busyRef.current) return;
        busyRef.current = true; setExporting(true); setError("");
        try {
            const html = await buildResumeDocumentHtml(savedResume);
            const blob = await api.post(`/resumes/${savedResume.id}/pdf`, { html, template_id: savedResume.template_id }, true, { responseType: "blob", validateStatus: () => true });
            if (blob instanceof Blob && !blob.type.includes("application/pdf")) {
                let message = "The server did not return a valid PDF. Please try again.";
                try { const payload = JSON.parse(await blob.text()); message = payload.msg || payload.message || message; } catch { /* Keep a useful fallback for non-JSON errors. */ }
                throw new Error(message);
            }
            if (!(blob instanceof Blob) || !blob.size || await blob.slice(0, 5).text() !== "%PDF-") throw new Error("The server did not return a valid PDF. Please try again.");
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url; link.download = `${(savedResume.title || "Resume").replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")}.pdf`;
            document.body.appendChild(link); link.click(); link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (err) { setError(err.message || "Unable to generate your PDF. Please try again."); }
        finally { busyRef.current = false; setExporting(false); }
    };
    const printResume = async () => {
        if (!savedResume?.id || busy || busyRef.current) return;
        const popup = window.open("", "_blank");
        if (!popup) { setError("Allow pop-ups for this page to print your resume."); return; }
        popup.opener = null; busyRef.current = true; setExporting(true); setError("");
        try {
            popup.document.write(await buildResumeDocumentHtml(savedResume)); popup.document.close();
            await Promise.all(Array.from(popup.document.images, image => image.decode().catch(() => {})));
            await popup.document.fonts?.ready;
            popup.focus(); popup.print();
        } catch (err) { popup.close(); setError(err.message || "Unable to prepare your resume for printing."); }
        finally { busyRef.current = false; setExporting(false); }
    };

    if (loading && !currentResume) return <div className="resume-builder-loading"><Spinner animation="border" variant="success" /><p>Loading Resume Builder...</p></div>;
    return <div className="resume-builder-page">
        <header className="resume-builder-header">
            <div><p className="resume-eyebrow">YOUR NEXT CHAPTER</p><h1>Resume Builder</h1><p>Create a professional resume in three simple steps.</p></div>
            <div className="resume-management-actions"><Dropdown>
                <Dropdown.Toggle variant="outline-success" disabled={busy}>My Resumes</Dropdown.Toggle>
                <Dropdown.Menu>{!resumes.length && <Dropdown.Item disabled>No saved resumes yet</Dropdown.Item>}{resumes.map(resume => <Dropdown.Item key={resume.id} active={String(currentResume?.id) === String(resume.id)} onClick={() => openResume(resume.id)}>{resume.title || "My Resume"}</Dropdown.Item>)}</Dropdown.Menu>
            </Dropdown><Button variant="success" onClick={startNewResume} disabled={busy}><FaPlus /> New Resume</Button></div>
        </header>
        <ol className="resume-stepper" aria-label="Resume creation progress">{steps.map((label, index) => <li key={label} className={step === index + 1 ? "active" : step > index + 1 ? "complete" : ""} aria-current={step === index + 1 ? "step" : undefined}><span className="resume-step-number">{step > index + 1 ? <FaCheck /> : index + 1}</span><span>{label}</span></li>)}</ol>
        <div aria-live="polite">
            {error && <Alert variant="danger" dismissible onClose={() => setError("")}>{error}{!currentResume && <Button variant="outline-danger" className="ms-3" onClick={() => setReloadKey(key => key + 1)}>Retry</Button>}</Alert>}
            {notice && <Alert variant="success" dismissible onClose={() => setNotice("")}>{notice}</Alert>}
            {cacheWarning && <Alert variant="warning">{cacheWarning}</Alert>}
            {loading && <p><Spinner size="sm" animation="border" /> Loading resume...</p>}
        </div>
        {currentResume && <>
            <section hidden={step !== 1} aria-labelledby="resume-information-title">
                <div className="resume-step-heading"><div><h2 tabIndex={-1} id="resume-information-title">Resume Information</h2><p>Add your experience and achievements. Optional sections can be left empty.</p></div><span className="resume-save-indicator">{saving ? "Saving..." : dirty ? "Unsaved changes" : "Saved"}</span></div>
                <fieldset disabled={busy} className="resume-editor-fields">
                    <div className="resume-document-name"><Form.Group controlId="resume-document-title"><Form.Label>Resume name</Form.Label><Form.Control maxLength={255} value={currentResume.title} onChange={event => changeDraft({ title: event.target.value })} placeholder="My Resume" /></Form.Group><div className="resume-history-buttons"><Button variant="outline-secondary" onClick={undo} disabled={!undoStack.length || busy} aria-label="Undo last change"><FaUndo /></Button><Button variant="outline-secondary" onClick={redo} disabled={!redoStack.length || busy} aria-label="Redo last change"><FaRedo /></Button></div></div>
                    <ResumeEditor key={currentResume.settings?.client_draft_id || currentResume.id || "new-resume"} resume={currentResume} onChange={changeDraft} errors={fieldErrors} onPhotoBusyChange={setPhotoBusy} />
                </fieldset>
                <details className="resume-completion-details"><summary>Resume completeness <strong>{resumeCompletion(currentResume)}%</strong></summary><ResumeScorePanel resume={currentResume} /></details>
                <footer className="resume-step-footer"><Button variant="outline-success" onClick={() => saveResume(false)} disabled={busy}><FaSave /> {saving ? "Saving..." : "Save Progress"}</Button><Button variant="success" onClick={() => { if (validate()) setStep(2); }} disabled={busy}>Continue to Templates <FaArrowRight /></Button></footer>
            </section>
            {step === 2 && <section aria-labelledby="resume-template-title">
                <div className="resume-step-heading"><div><h2 tabIndex={-1} id="resume-template-title">Choose Template</h2><p>Select a design for your resume. Your information stays the same in every template.</p></div></div>
                <fieldset disabled={busy} className="resume-editor-fields"><TemplateSelector currentTemplate={currentResume.template_id} onSelect={template_id => changeDraft({ template_id })} resume={currentResume} />
                    <details className="resume-appearance-settings"><summary>Customize typography &amp; accent</summary><div className="resume-appearance-grid">
                        <Form.Group controlId="resume-font-family"><Form.Label>Font</Form.Label><Form.Select value={currentResume.font_family || "Arial, sans-serif"} onChange={event => changeDraft({ font_family: event.target.value })}>{["Arial, sans-serif", "Inter, sans-serif", "Georgia, serif", "Times New Roman, serif"].map(font => <option key={font} value={font}>{font.split(",")[0]}</option>)}</Form.Select></Form.Group>
                        <Form.Group controlId="resume-font-size"><Form.Label>Text size</Form.Label><Form.Select value={currentResume.font_size || 11} onChange={event => changeDraft({ font_size: Number(event.target.value) })}>{[8, 9, 10, 11, 12, 13, 14].map(size => <option key={size} value={size}>{size} pt</option>)}</Form.Select></Form.Group>
                        <Form.Group controlId="resume-line-spacing"><Form.Label>Line spacing</Form.Label><Form.Select value={currentResume.line_spacing || 1.45} onChange={event => changeDraft({ line_spacing: Number(event.target.value) })}>{[1.2, 1.35, 1.45, 1.5, 1.65, 1.8].map(spacing => <option key={spacing} value={spacing}>{spacing}</option>)}</Form.Select></Form.Group>
                        <Form.Group controlId="resume-accent"><Form.Label>Accent color</Form.Label><Form.Control type="color" value={/^#[\da-f]{6}$/i.test(currentResume.color_theme || "") ? currentResume.color_theme : "#065845"} onChange={event => changeDraft({ color_theme: event.target.value })} /></Form.Group>
                    </div></details>
                </fieldset>
                <footer className="resume-step-footer"><Button variant="outline-success" onClick={() => setStep(1)} disabled={busy}><FaArrowLeft /> Back to Information</Button><Button variant="success" onClick={() => saveResume(true)} disabled={busy}>{saving ? <><Spinner size="sm" animation="border" /> Saving &amp; Generating...</> : <>Save &amp; Generate Resume <FaArrowRight /></>}</Button></footer>
            </section>}
            {step === 3 && savedResume && <section aria-labelledby="resume-preview-title">
                <div className="resume-step-heading"><div><h2 tabIndex={-1} id="resume-preview-title">Preview &amp; Download</h2><p>Review your saved resume, then download or print it.</p></div><span className="resume-save-indicator saved"><FaCheck /> Saved</span></div>
                <div className="resume-final-layout"><div className="resume-final-preview"><ResumePreview resume={savedResume} /></div><aside className="resume-final-aside">
                    <div className="resume-actions-card"><h3>Resume Actions</h3><Button variant="success" onClick={downloadPdf} disabled={busy}>{exporting ? <Spinner size="sm" animation="border" /> : <FaFilePdf />} {exporting ? "Preparing document..." : "Download Resume (PDF)"}</Button><Button variant="outline-success" onClick={() => { setStep(1); setNotice(""); }} disabled={busy}>Edit Information</Button><Button variant="outline-success" onClick={() => { setStep(2); setNotice(""); }} disabled={busy}>Change Template</Button><Button variant="outline-secondary" onClick={printResume} disabled={busy}><FaPrint /> Print Resume</Button><Button variant="outline-secondary" onClick={duplicateResume} disabled={busy}><FaCopy /> Duplicate Resume</Button></div>
                    <div className="resume-template-info"><span className="resume-eyebrow">SELECTED TEMPLATE</span><h3>{selectedTemplate?.name}</h3><p>{selectedTemplate?.description}</p><span className="resume-template-format">A4 · PDF &amp; print ready</span></div>
                    <p className="resume-saved-caption">{savedResume.title}{savedResume.updatedAt && <> · Saved {new Date(savedResume.updatedAt).toLocaleDateString()}</>}</p>
                </aside></div>
            </section>}
        </>}
    </div>;
}
