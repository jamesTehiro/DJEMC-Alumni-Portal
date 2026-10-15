import React, { useEffect, useRef, useState } from "react";
import { Alert, Button, Form, Modal, ProgressBar, Spinner } from "react-bootstrap";
import { useNavigate } from "react-router-dom";
import { FaArrowLeft, FaArrowRight, FaCheck, FaPlus, FaSave, FaTrash } from "react-icons/fa";
import { api } from "../services/api";
import MembershipReview from "../components/membership/MembershipReview";
import { MEMBERSHIP_PERSONAL_FIELDS, MEMBERSHIP_ROW_FIELDS, MEMBERSHIP_SECTIONS,
    ageFromBirthDate, createMembershipDraft, ensureEducationLevels, membershipFingerprint,
    membershipPayload, unwrapMembershipResponse, validateMembershipApplication } from "../utils/membershipApplication";
import "./MembershipApplicationPage.css";

const instruction = "Please complete all sections of this form accurately and honestly. Ensure that the information you provide is correct. If a field does not apply to you, please indicate N/A. Your responses will remain confidential and will be used solely for the stated purpose.";
const consentFallback = "I hereby certify that the above-mentioned information/data is true and correct. I acknowledge that the provided information will be kept confidential and used solely for the stated purpose. My personal data will not be shared with third parties without my explicit consent, except as required by law.";
const noEntryLabels = {
    work_experience: "No Work Experience",
    training_seminars: "No training or seminar information applies",
    community_involvement: "No community involvement information applies",
    awards_citations: "No awards or citations to report"
};
const addLabels = {
    work_experience: "Add Work Experience", training_seminars: "Add Training / Seminar",
    community_involvement: "Add Community Involvement", awards_citations: "Add Award"
};

function MembershipField({ field, value, onChange, id, error, readOnly = false }) {
    const common = { id, value: value || "", onChange: event => onChange(event.target.value), isInvalid: Boolean(error),
        "aria-describedby": error ? `${id}-error` : undefined, required: field.required, readOnly,
        maxLength: ["last_name", "first_name", "middle_name", "extension"].includes(field.key) ? 120 : 2000 };
    return <Form.Group className={`membership-field${field.multiline ? " membership-field-wide" : ""}`}>
        <Form.Label htmlFor={id}>{field.label}{field.required && <span className="membership-required" aria-label=" required"> *</span>}</Form.Label>
        {field.choices && !readOnly ? <Form.Select {...common} readOnly={undefined}>
            <option value="">Select or leave blank</option>
            {value && !field.choices.includes(value) && value !== "N/A" && <option value={value}>{value}</option>}
            {field.choices.map(option => <option key={option}>{option}</option>)}
            <option value="N/A">N/A</option>
        </Form.Select> : <Form.Control {...common} as={field.multiline ? "textarea" : "input"}
            type={field.multiline ? undefined : field.type || "text"} rows={field.multiline ? 2 : undefined}
            inputMode={field.inputMode} max={field.type === "date" && field.key === "date_of_birth" ? `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-${String(new Date().getDate()).padStart(2, "0")}` : undefined} />}
        {error && <Form.Control.Feedback type="invalid" id={`${id}-error`}>{error}</Form.Control.Feedback>}
        {readOnly && <Form.Text>Verified Registrar information</Form.Text>}
    </Form.Group>;
}

export function MembershipEducationTable({ rows, academicVerified, onChange }) {
    return <div className="membership-education-scroll" role="region" aria-label="Educational attainment fields" tabIndex={0}>
        <table className="membership-education-table">
            <caption className="visually-hidden">Educational attainment by level and school.</caption>
            <thead><tr><th scope="col">Education Level / School</th>{MEMBERSHIP_ROW_FIELDS.educational_attainment.slice(2).map(field => <th scope="col" key={field.key}>{field.label}</th>)}</tr></thead>
            <tbody>{rows.map((row, index) => {
                const official = academicVerified && /bachelor/i.test(row.level);
                return <tr key={index}><th scope="row">{row.level}
                    <MembershipField field={MEMBERSHIP_ROW_FIELDS.educational_attainment[1]}
                        id={`membership-education-${index}-school_name`} value={row.school_name}
                        readOnly={official} onChange={value => onChange(index, "school_name", value)} />
                    </th>
                    {MEMBERSHIP_ROW_FIELDS.educational_attainment.slice(2).map(field => <td key={field.key}>
                        <MembershipField
                            field={field}
                            id={`membership-education-${index}-${field.key}`} value={row[field.key]}
                            readOnly={official && field.key === "year_graduated"}
                            onChange={value => onChange(index, field.key, value)} />
                    </td>)}
                </tr>;
            })}</tbody>
        </table>
    </div>;
}

export default function MembershipApplicationPage({ embedded = false, onClose, onConfirmedSave, closeRequestRef }) {
    const navigate = useNavigate();
    const [draft, setDraft] = useState(null);
    const [savedFingerprint, setSavedFingerprint] = useState("");
    const [step, setStep] = useState(0);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [fieldErrors, setFieldErrors] = useState({});
    const [accepted, setAccepted] = useState(false);
    const [completion, setCompletion] = useState({ submitted: false, profile_completed: false });
    const [academicVerified, setAcademicVerified] = useState(false);
    const [consentText, setConsentText] = useState(consentFallback);
    const [showSuccess, setShowSuccess] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);
    const busyRef = useRef(false);
    const draftRef = useRef(null);
    const submitted = completion.submitted === true;
    const dirty = Boolean(draft && !submitted && membershipFingerprint(draft) !== savedFingerprint);
    const currentSection = MEMBERSHIP_SECTIONS[step];
    const validation = draft ? validateMembershipApplication(draft, accepted) : {};
    const canSubmit = draft && !saving && !submitted && Object.keys(validation).length === 0;

    useEffect(() => {
        let cancelled = false;
        async function load() {
            setLoading(true); setError(""); setNotice("");
            try {
                const result = unwrapMembershipResponse(await api.get("/membership/me", true));
                if (cancelled) return;
                const next = result.application ? ensureEducationLevels(result.application) : createMembershipDraft(result.prefill);
                draftRef.current = next; setDraft(next);
                setSavedFingerprint(membershipFingerprint(next));
                setCompletion(result.completion || { submitted: false, profile_completed: false });
                setAcademicVerified(result.prefill?.academic_verified === true);
                setConsentText(result.consent?.text || consentFallback);
                setAccepted(false);
                setFieldErrors({});
                setStep(result.completion?.submitted === true ? 6 : 0);
            } catch (err) {
                if (!cancelled) setError(err.message || "Unable to load your membership application.");
            } finally { if (!cancelled) setLoading(false); }
        }
        load();
        return () => { cancelled = true; };
    }, [reloadKey]);

    useEffect(() => {
        if (!dirty) return;
        const warn = event => { event.preventDefault(); event.returnValue = ""; };
        window.addEventListener("beforeunload", warn);
        return () => window.removeEventListener("beforeunload", warn);
    }, [dirty]);

    useEffect(() => { document.getElementById("membership-section-title")?.focus({ preventScroll: true }); }, [step]);

    const changeDraft = update => {
        if (busyRef.current || submitted) return;
        const next = update(draftRef.current);
        draftRef.current = next; setDraft(next);
        setAccepted(false); setNotice(""); setFieldErrors({});
    };
    const changePersonal = (key, value) => changeDraft(previous => ({ ...previous, personal_details: { ...previous.personal_details, [key]: value } }));
    const changeRow = (section, index, key, value) => changeDraft(previous => ({ ...previous,
        [section]: previous[section].map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row) }));
    const addRow = section => changeDraft(previous => ({ ...previous,
        [section]: [...previous[section], Object.fromEntries(MEMBERSHIP_ROW_FIELDS[section].map(field => [field.key, ""]))] }));
    const removeRow = (section, index) => changeDraft(previous => ({ ...previous, [section]: previous[section].filter((_, rowIndex) => rowIndex !== index) }));
    const goToStep = index => { if (saving) return; setStep(index); setError(""); };
    const leave = () => {
        if (busyRef.current) return;
        if (!dirty || window.confirm("You have unsaved membership information. Close without saving the draft?")) {
            if (onClose) onClose(); else navigate("/dashboard");
        }
    };
    useEffect(() => {
        if (!closeRequestRef) return;
        closeRequestRef.current = () => {
            if (busyRef.current) return;
            if (!dirty || window.confirm("You have unsaved membership information. Close without saving the draft?")) onClose?.();
        };
        return () => { closeRequestRef.current = null; };
    }, [closeRequestRef, dirty, onClose]);
    const proceed = () => { onClose?.(); navigate(completion.profile_completed ? "/dashboard" : "/profile?membership=1"); };

    const persist = async submit => {
        if (busyRef.current || !draftRef.current || submitted) return;
        if (submit) {
            const errors = validateMembershipApplication(draftRef.current, accepted);
            setFieldErrors(errors);
            if (Object.keys(errors).length) {
                setError("Complete the required personal details and accept the declaration before submitting.");
                if (Object.keys(errors).some(key => key !== "consent_accepted")) setStep(0);
                return;
            }
        }
        busyRef.current = true; setSaving(true); setError(""); setNotice("");
        try {
            const payload = membershipPayload(draftRef.current, submit && accepted);
            const response = submit ? await api.post("/membership/me/submit", payload, true) : await api.put("/membership/me/draft", payload, true);
            const result = unwrapMembershipResponse(response);
            if (!result.application?.id) throw new Error("The server did not confirm that your application was saved. Please try again.");
            if (submit && result.completion?.submitted !== true) {
                throw new Error("Submission was not confirmed. Your information has been kept here so you can safely retry.");
            }
            const next = ensureEducationLevels(result.application);
            draftRef.current = next; setDraft(next); setSavedFingerprint(membershipFingerprint(next));
            setCompletion(result.completion || { submitted: submit, profile_completed: false });
            onConfirmedSave?.(result);
            setFieldErrors({});
            if (submit || result.completion?.submitted === true) {
                setStep(6); setShowSuccess(true);
            } else setNotice("Draft saved successfully. You can return to complete your application later.");
        } catch (err) {
            setError(err.message || "The application could not be saved. Please try again.");
            const personalField = /^personal_details\.([a-z_]+)$/.exec(err.field || "")?.[1];
            if (personalField && MEMBERSHIP_PERSONAL_FIELDS.some(field => field.key === personalField)) {
                setFieldErrors({ [personalField]: err.message });
                setStep(0);
            }
        }
        finally { busyRef.current = false; setSaving(false); }
    };

    if (loading) return <div className="membership-page membership-loading" role="status"><Spinner animation="border" /><p>Loading your membership application…</p></div>;
    if (!draft) return <div className="membership-page"><h1>Membership Application Form</h1>
        <Alert variant="danger">{error || "Your membership application could not be loaded."}</Alert>
        <Button variant="success" onClick={() => setReloadKey(key => key + 1)}>Retry</Button>{" "}
        <Button variant="outline-secondary" onClick={() => onClose ? onClose() : navigate("/dashboard")}>{embedded ? "Close" : "Return to Dashboard"}</Button>
    </div>;

    return <div className="membership-page">
        <header className="membership-page-header">
            <div><p className="membership-eyebrow">DJEMC Alumni Association</p><h1>Membership Application Form</h1>
                <p>P-5 Justiniana Edera, San Jose, Dinagat Islands</p></div>
            <Button type="button" variant="outline-secondary" onClick={leave} disabled={saving}><FaArrowLeft /> {embedded ? "Close" : "Dashboard"}</Button>
        </header>
        {error && <Alert variant="danger" role="alert">{error}</Alert>}
        {notice && <Alert variant="success" role="status">{notice}</Alert>}
        {submitted ? <>
            <Alert variant="success" className="membership-submitted-state">
                <div><h2>Membership Application Submitted Successfully!</h2>
                    <p>Your membership application has been submitted and recorded. You may now proceed to complete your alumni profile.</p>
                    <p className="membership-approval-note">Submission does not mean association membership has been approved.</p></div>
                <Button variant="success" onClick={proceed}>
                    {completion.profile_completed ? "Continue to Dashboard" : "Proceed to Profile Information"} <FaArrowRight />
                </Button>
            </Alert>
            <div className="membership-card"><h2>Submitted application</h2>
                <p className="membership-help">This saved application is read-only. You do not need to submit it again.</p>
                <MembershipReview application={draft} consentText={consentText} />
            </div>
        </> : <>
            <p className="membership-instruction">{instruction}</p>
            <div className="membership-progress">
                <div><span>{step < 6 ? `Section ${step + 1} of 6` : "Review and consent"}</span><span>{dirty ? "Unsaved changes" : draft.id ? "Saved draft" : "New application"}</span></div>
                <ProgressBar now={((step + 1) / 7) * 100} aria-label="Application progress" />
            </div>
            <div className="membership-workspace">
                <nav className="membership-section-nav" aria-label="Membership application sections">
                    {MEMBERSHIP_SECTIONS.map((section, index) => <button type="button" key={section.key} disabled={saving}
                        className={step === index ? "active" : ""} aria-current={step === index ? "step" : undefined} onClick={() => goToStep(index)}>
                        <span>{section.numeral}</span>{section.title}
                    </button>)}
                    <button type="button" disabled={saving} className={step === 6 ? "active" : ""} aria-current={step === 6 ? "step" : undefined} onClick={() => goToStep(6)}><span><FaCheck /></span>Review &amp; Consent</button>
                    <p>Save a draft to continue later. Your membership information is not published to the Alumni Directory.</p>
                </nav>
                <Form noValidate onSubmit={event => event.preventDefault()} className="membership-card">
                    <fieldset disabled={saving} className="membership-fields-container">
                        <h2 id="membership-section-title" tabIndex={-1}>{currentSection ? `${currentSection.numeral}. ${currentSection.title}` : "Review Application"}</h2>
                        {step === 0 && <>
                            <p className="membership-help">Fields marked * are required. Sensitive and other nonessential fields are optional.</p>
                            {[{ title: "Name", start: 0, end: 4 }, { title: "Personal Information", start: 4, end: 16 }, { title: "Professional and Contact Information", start: 16, end: 24 }].map(group => <section className="membership-personal-group" key={group.title}>
                                <h3>{group.title}</h3>
                                <div className="membership-input-grid">
                                    {MEMBERSHIP_PERSONAL_FIELDS.slice(group.start, group.end).map(field => <React.Fragment key={field.key}>
                                        <MembershipField field={field} id={`membership-${field.key}`} value={draft.personal_details[field.key]} error={fieldErrors[field.key]}
                                            onChange={value => changePersonal(field.key, value)} />
                                        {field.key === "date_of_birth" && <Form.Group className="membership-field"><Form.Label htmlFor="membership-age">Age (calculated from Date of Birth)</Form.Label>
                                            <Form.Control id="membership-age" readOnly value={ageFromBirthDate(draft.personal_details.date_of_birth)} placeholder="Select a valid date of birth" /></Form.Group>}
                                    </React.Fragment>)}
                                </div>
                            </section>)}
                        </>}
                        {step === 1 && <>
                            <p className="membership-help">Complete applicable levels. Verified DJEMC academic information is shown for reference and cannot change Registrar records.</p>
                            <MembershipEducationTable rows={draft.educational_attainment} academicVerified={academicVerified}
                                onChange={(index, key, value) => changeRow("educational_attainment", index, key, value)} />
                        </>}
                        {step >= 2 && step < 6 && <>
                            <Form.Check className="membership-no-entries" id={`membership-${currentSection.emptyFlag}`} type="checkbox"
                                label={noEntryLabels[currentSection.key]} checked={draft.options[currentSection.emptyFlag]}
                                onChange={event => changeDraft(previous => ({ ...previous, options: { ...previous.options, [currentSection.emptyFlag]: event.target.checked } }))} />
                            {draft.options[currentSection.emptyFlag] ? <p className="membership-help">This section will be saved with no entries. Uncheck this option to enter information.</p> : <>
                                {draft[currentSection.key].length === 0 && <p className="membership-help">No entries yet. Add an applicable entry or choose the option above.</p>}
                                {draft[currentSection.key].map((row, index) => <section className="membership-repeatable-row" key={`${currentSection.key}-${index}`}>
                                    <header><h3>Entry {index + 1}</h3><Button type="button" variant="outline-danger" size="sm" onClick={() => removeRow(currentSection.key, index)}
                                        aria-label={`Remove ${currentSection.title.toLowerCase()} entry ${index + 1}`}><FaTrash /> Remove</Button></header>
                                    <div className="membership-input-grid">
                                        {MEMBERSHIP_ROW_FIELDS[currentSection.key].map(field => <MembershipField key={field.key} field={field}
                                            id={`membership-${currentSection.key}-${index}-${field.key}`} value={row[field.key]}
                                            onChange={value => changeRow(currentSection.key, index, field.key, value)} />)}
                                    </div>
                                </section>)}
                                <Button type="button" variant="outline-success" disabled={draft[currentSection.key].length >= 50} onClick={() => addRow(currentSection.key)}><FaPlus /> {addLabels[currentSection.key]}</Button>
                                {draft[currentSection.key].length >= 50 && <p className="membership-help">A maximum of 50 entries is supported in this section.</p>}
                            </>}
                        </>}
                        {step === 6 && <>
                            <p className="membership-help">Review your information before submitting. Use Edit section to make corrections.</p>
                            <MembershipReview application={draft} onEdit={goToStep} showConsent={false} />
                            <section className="membership-consent">
                                <h3>Consent and Declaration</h3><p>{consentText}</p>
                                <Form.Check id="membership-consent" type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)}
                                    label="I have read and understood the declaration and confirm that the information I provided is accurate." />
                                {Object.keys(validation).some(key => key !== "consent_accepted") && <Alert variant="warning" className="mt-3">
                                    Complete the required Name, Email Address, and Contact Number fields in Personal Details before submitting.
                                    <Button type="button" variant="link" onClick={() => goToStep(0)}>Return to Personal Details</Button>
                                </Alert>}
                                <p className="membership-help">Submitting records your application. It does not automatically approve association membership.</p>
                            </section>
                        </>}
                    </fieldset>
                    <footer className="membership-form-footer">
                        <Button type="button" variant="outline-success" disabled={saving} onClick={() => persist(false)}><FaSave /> {saving ? "Saving…" : "Save Draft"}</Button>
                        <div>
                            {step > 0 && <Button type="button" variant="outline-secondary" disabled={saving} onClick={() => goToStep(step - 1)}><FaArrowLeft /> Back</Button>}
                            {step < 6 ? <Button type="button" variant="success" disabled={saving} onClick={() => goToStep(step + 1)}>{step === 5 ? "Review Application" : "Next Section"} <FaArrowRight /></Button>
                                : <Button type="button" variant="success" disabled={!canSubmit} onClick={() => persist(true)}>{saving ? <Spinner animation="border" size="sm" /> : <FaCheck />} Submit Membership Application</Button>}
                        </div>
                    </footer>
                </Form>
            </div>
        </>}
        <Modal show={showSuccess && !embedded} onHide={() => setShowSuccess(false)} centered className="membership-success-modal">
            <Modal.Header closeButton><Modal.Title>Membership Application Submitted Successfully!</Modal.Title></Modal.Header>
            <Modal.Body><p>Your membership application has been submitted and recorded. You may now proceed to complete your alumni profile.</p>
                <p>Submission does not automatically approve association membership.</p></Modal.Body>
            <Modal.Footer><Button variant="success" onClick={() => navigate("/profile?membership=1")}>Proceed to Profile Information <FaArrowRight /></Button></Modal.Footer>
        </Modal>
    </div>;
}
