import React, { useEffect, useRef, useState } from "react";
import { Button, Modal } from "react-bootstrap";
import { api } from "../../../services/api";

const EMPTY_DETAILS = {
    agency_name: "",
    agency_classification: "",
    department_ministry: "",
    regional_office: "",
    office_address: "",
    agency_email: "",
    agency_contact_number: "",
    agency_website: "",
    representative_name: "",
    representative_designation: "",
    representative_department: "",
    representative_email: "",
    representative_contact_number: "",
    signature_printed_name: "",
    signature_designation: "",
    date_signed: "",
    signature_declaration_accepted: false
};
const DESIGNATIONS = ["Provincial Director", "Regional Director", "Municipal Mayor", "Department Head", "Division Chief", "Agency Administrator", "Authorized Representative", "Other"];
const MAX_IMAGE_BYTES = 512 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 768 * 1024;

const validImage = file => file && ["image/png", "image/jpeg"].includes(file.type) && file.size <= MAX_IMAGE_BYTES;

export default function GovernmentAgencyRegistrationForm({ onBundleChange, onComplete, onAccountDetails }) {
    const [showForm, setShowForm] = useState(false);
    const [showPreview, setShowPreview] = useState(false);
    const [details, setDetails] = useState(EMPTY_DETAILS);
    const [designationOption, setDesignationOption] = useState("");
    const [otherDesignation, setOtherDesignation] = useState("");
    const [signature, setSignature] = useState(null);
    const [seal, setSeal] = useState(null);
    const [pdf, setPdf] = useState(null);
    const [pdfUrl, setPdfUrl] = useState("");
    const [signatureUrl, setSignatureUrl] = useState("");
    const [error, setError] = useState("");
    const [generating, setGenerating] = useState(false);
    const printFrame = useRef(null);
    const pdfUrlRef = useRef("");
    const signatureUrlRef = useRef("");
    useEffect(() => () => {
        if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current);
        if (signatureUrlRef.current) URL.revokeObjectURL(signatureUrlRef.current);
    }, []);

    const invalidatePreview = () => {
        setPdf(null);
        if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current);
        pdfUrlRef.current = "";
        setPdfUrl("");
        onBundleChange(null);
    };

    const updateDetails = (field, value) => {
        const updated = { ...details, [field]: value };
        setDetails(updated);
        invalidatePreview();
        if (field === "agency_name" || field === "office_address" || field === "agency_website") {
            onAccountDetails?.({
                name: updated.agency_name,
                companyAddress: updated.office_address,
                websiteUrl: updated.agency_website
            });
        }
    };

    const selectImage = (kind, file) => {
        setError("");
        if (!file) return;
        if (!validImage(file)) {
            setError("Signature and seal images must be PNG or JPG files no larger than 512 KB each.");
            return;
        }
        const nextSignature = kind === "signature" ? file : signature;
        const nextSeal = kind === "seal" ? file : seal;
        if ((nextSignature?.size || 0) + (nextSeal?.size || 0) > MAX_TOTAL_IMAGE_BYTES) {
            setError("The signature and agency seal images must total no more than 768 KB.");
            return;
        }
        if (kind === "signature") {
            if (signatureUrlRef.current) URL.revokeObjectURL(signatureUrlRef.current);
            signatureUrlRef.current = URL.createObjectURL(file);
            setSignatureUrl(signatureUrlRef.current);
            setSignature(file);
        } else setSeal(file);
        invalidatePreview();
    };

    const generatePreview = async event => {
        event.preventDefault();
        setError("");
        const actualDesignation = designationOption === "Other" ? otherDesignation.trim() : designationOption;
        const formDetails = {
            ...details,
            representative_designation: actualDesignation,
            signature_declaration_accepted: Boolean(details.signature_declaration_accepted)
        };
        const required = [
            "agency_name", "agency_classification", "office_address", "agency_email", "agency_contact_number",
            "representative_name", "representative_designation", "representative_department", "representative_email",
            "representative_contact_number", "signature_printed_name", "signature_designation", "date_signed"
        ];
        if (required.some(field => !String(formDetails[field] || "").trim()) || !signature || !formDetails.signature_declaration_accepted) {
            setError("Complete all required agency and representative fields, upload the representative's signature, and accept the declaration.");
            return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formDetails.agency_email) ||
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formDetails.representative_email)) {
            setError("Enter valid agency and representative email addresses.");
            return;
        }
        setGenerating(true);
        try {
            const payload = new FormData();
            payload.append("details", JSON.stringify(formDetails));
            payload.append("government_signature", signature);
            if (seal) payload.append("government_seal", seal);
            const response = await api.post("/auth/employer-government-agency/consent-preview", payload, false);
            const bytes = Uint8Array.from(atob(response.pdf_base64), character => character.charCodeAt(0));
            const generatedPdf = new Blob([bytes], { type: "application/pdf" });
            setDetails(formDetails);
            if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current);
            pdfUrlRef.current = URL.createObjectURL(generatedPdf);
            setPdfUrl(pdfUrlRef.current);
            setPdf(generatedPdf);
            const bundle = { details: formDetails, signature, seal, pdf: generatedPdf, previewToken: response.preview_token };
            onComplete(bundle);
            onBundleChange(bundle);
            onAccountDetails?.({
                name: formDetails.agency_name,
                companyAddress: formDetails.office_address,
                websiteUrl: formDetails.agency_website
            });
            setShowForm(false);
            setShowPreview(true);
        } catch (requestError) {
            setError(requestError.message || "Unable to generate the authorization PDF. Please try again.");
        } finally {
            setGenerating(false);
        }
    };

    const openEditor = () => {
        setError("");
        setShowForm(true);
    };

    return (
        <div className="government-agency-form-actions">
            <Button type="button" variant="outline-success" onClick={openEditor}>
                {pdf ? "Edit Government Agency Form" : "Complete Government Agency Form"}
            </Button>
            {pdf && <Button type="button" variant="outline-primary" onClick={() => setShowPreview(true)}>View Generated Consent PDF</Button>}

            <Modal show={showForm} onHide={() => setShowForm(false)} centered size="lg" scrollable dialogClassName="government-agency-modal">
                <Modal.Header closeButton>
                    <Modal.Title>Government Agency Registration and Authorization Form</Modal.Title>
                </Modal.Header>
                <form onSubmit={generatePreview}>
                    <Modal.Body>
                        {error && <p className="alert alert-danger" role="alert">{error}</p>}
                        <section className="government-form-section">
                            <h3>Section A – Agency Information</h3>
                            <div className="government-form-grid">
                                <label>Government Agency / Office Name *<input name="agency_name" required value={details.agency_name} onChange={event => updateDetails("agency_name", event.target.value)} /></label>
                                <label>Agency Type or Classification *<input name="agency_classification" required value={details.agency_classification} onChange={event => updateDetails("agency_classification", event.target.value)} /></label>
                                <label>Department / Ministry<input name="department_ministry" value={details.department_ministry} onChange={event => updateDetails("department_ministry", event.target.value)} /></label>
                                <label>Regional Office / Division<input name="regional_office" value={details.regional_office} onChange={event => updateDetails("regional_office", event.target.value)} /></label>
                                <label className="wide">Complete Office Address *<textarea name="office_address" required rows="2" value={details.office_address} onChange={event => updateDetails("office_address", event.target.value)} /></label>
                                <label>Official Agency Email Address *<input name="agency_email" required type="email" value={details.agency_email} onChange={event => updateDetails("agency_email", event.target.value)} /></label>
                                <label>Official Contact Number *<input name="agency_contact_number" required type="tel" value={details.agency_contact_number} onChange={event => updateDetails("agency_contact_number", event.target.value)} /></label>
                                <label className="wide">Agency Website (optional)<input name="agency_website" type="url" value={details.agency_website} onChange={event => updateDetails("agency_website", event.target.value)} /></label>
                            </div>
                        </section>
                        <section className="government-form-section">
                            <h3>Section B – Authorized Representative Information</h3>
                            <div className="government-form-grid">
                                <label>Full Name of Authorized Representative *<input name="representative_name" required value={details.representative_name} onChange={event => updateDetails("representative_name", event.target.value)} /></label>
                                <label>Official Position / Designation *
                                    <select name="representative_designation" required value={designationOption} onChange={event => { setDesignationOption(event.target.value); updateDetails("representative_designation", event.target.value === "Other" ? otherDesignation : event.target.value); }}>
                                        <option value="">Select designation</option>
                                        {DESIGNATIONS.map(value => <option key={value}>{value}</option>)}
                                    </select>
                                </label>
                                {designationOption === "Other" && <label>Specify Designation *<input name="other_designation" required value={otherDesignation} onChange={event => { setOtherDesignation(event.target.value); updateDetails("representative_designation", event.target.value); }} /></label>}
                                <label>Department / Office *<input name="representative_department" required value={details.representative_department} onChange={event => updateDetails("representative_department", event.target.value)} /></label>
                                <label>Official Email Address *<input name="representative_email" required type="email" value={details.representative_email} onChange={event => updateDetails("representative_email", event.target.value)} /></label>
                                <label>Contact Number *<input name="representative_contact_number" required type="tel" value={details.representative_contact_number} onChange={event => updateDetails("representative_contact_number", event.target.value)} /></label>
                            </div>
                        </section>
                        <section className="government-form-section">
                            <h3>Section C – Authorized Representative's Signature</h3>
                            <div className="government-form-grid">
                                <label>Signature Image Upload * (PNG or JPG, 512 KB maximum)
                                    <input id="government-signature-upload" name="government_signature" type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" required={!signature} onChange={event => selectImage("signature", event.target.files?.[0])} />
                                </label>
                                <label>Printed Name *<input name="signature_printed_name" required value={details.signature_printed_name} onChange={event => updateDetails("signature_printed_name", event.target.value)} /></label>
                                <label>Official Position / Designation *<input name="signature_designation" required value={details.signature_designation} onChange={event => updateDetails("signature_designation", event.target.value)} /></label>
                                <label>Date Signed *<input name="date_signed" required type="date" value={details.date_signed} onChange={event => updateDetails("date_signed", event.target.value)} /></label>
                                <label>Official Agency Seal (optional; PNG or JPG, 512 KB maximum)
                                    <input name="government_seal" type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" onChange={event => selectImage("seal", event.target.files?.[0])} />
                                </label>
                                <div className="government-signature-preview" aria-label="Signature preview">
                                    <strong>Signature Preview</strong>
                                    {signature ? <img src={signatureUrl} alt="Authorized representative's signature preview" /> : <p>No signature uploaded.</p>}
                                    {signature && <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => document.getElementById("government-signature-replacement").click()}>Replace Signature</button>}
                                    <input id="government-signature-replacement" name="government_signature_replacement" className="visually-hidden" type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" onChange={event => selectImage("signature", event.target.files?.[0])} />
                                    {seal && <p>Agency seal selected: {seal.name}</p>}
                                </div>
                            </div>
                        </section>
                        <section className="government-form-section">
                            <h3>Section D – Declaration and Consent</h3>
                            <p>I declare that the information provided is accurate and complete; that I am authorized to register and manage this agency's employer account; and that the agency agrees to use the portal for legitimate recruitment and employment-related purposes. I understand the submitted information will undergo administrative verification and consent to its collection and processing for registration and verification.</p>
                            <p className="small text-muted">This declaration wording is newly introduced and requires institutional review. An uploaded signature image does not by itself establish legal authority.</p>
                            <label className="government-declaration-check">
                                <input type="checkbox" checked={details.signature_declaration_accepted} onChange={event => updateDetails("signature_declaration_accepted", event.target.checked)} />
                                I confirm this declaration and consent.
                            </label>
                        </section>
                    </Modal.Body>
                    <Modal.Footer>
                        <Button variant="secondary" type="button" onClick={() => setShowForm(false)}>Cancel</Button>
                        <Button variant="success" type="submit" disabled={generating}>{generating ? "Generating PDF..." : "Save and Generate Consent Form"}</Button>
                    </Modal.Footer>
                </form>
            </Modal>

            <Modal show={showPreview} onHide={() => setShowPreview(false)} centered fullscreen>
                <Modal.Header closeButton><Modal.Title>Government Agency Authorization PDF Preview</Modal.Title></Modal.Header>
                <Modal.Body className="government-pdf-preview">
                    {pdfUrl && <iframe ref={printFrame} title="Government agency authorization PDF preview" src={pdfUrl} />}
                </Modal.Body>
                <Modal.Footer>
                    <Button variant="outline-primary" disabled={!pdfUrl} onClick={() => printFrame.current?.contentWindow?.print()}>Print</Button>
                    {pdfUrl && <a className="btn btn-primary" href={pdfUrl} download="government-agency-registration-authorization.pdf">Download PDF</a>}
                    <Button variant="success" onClick={() => setShowPreview(false)}>Done</Button>
                </Modal.Footer>
            </Modal>
        </div>
    );
}
