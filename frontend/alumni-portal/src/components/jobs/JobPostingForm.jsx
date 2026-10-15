import React, { useId, useRef, useState } from "react";
import { EMPLOYMENT_TYPE_OPTIONS } from "../../utils/employmentTypes";
import { ADDITIONAL_BENEFITS, GOVERNMENT_BENEFITS, jobCompanyName, jobPostingPayload, validateJobPosting, WORK_SETUP_OPTIONS } from "../../utils/jobPosting";
import JobPostingAdvertisement from "./JobPostingAdvertisement";
import "./JobPosting.css";

function Section({ number, title, description, children }) {
    return <section className="job-posting-section"><header><span className="job-posting-section-number">{number}</span><div><h3>{title}</h3>{description && <p>{description}</p>}</div></header>{children}</section>;
}

function Field({ id, label, value, onChange, textarea = false, required = false, children, ...props }) {
    return <div className={`job-posting-field${textarea ? " job-posting-field-wide" : ""}`}>
        <label htmlFor={id}>{label}{required ? " *" : ""}</label>
        {children || (textarea ? <textarea id={id} value={value ?? ""} onChange={event => onChange(event.target.value)} required={required} rows={4} {...props} /> : <input id={id} value={value ?? ""} onChange={event => onChange(event.target.value)} required={required} {...props} />)}
    </div>;
}

function DynamicList({ id, label, items = [], onChange, placeholder }) {
    return <div className="job-posting-dynamic-list"><h4>{label}</h4>
        {items.map((value, index) => <div className="job-posting-list-input" key={index}>
            <input id={`${id}-${index}`} aria-label={`${label} ${index + 1}`} value={value} onChange={event => onChange(items.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} placeholder={placeholder} maxLength={1000} />
            <button className="job-posting-remove" type="button" onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove ${label.toLowerCase()} ${index + 1}`}>Remove</button>
        </div>)}
        <button className="job-posting-outline" type="button" disabled={items.length >= 100} onClick={() => onChange([...items, ""])}>+ Add {label === "Key Responsibilities" ? "Responsibility" : label === "Required Skills" ? "Skill" : label === "Other Benefits" ? "Benefit" : "Qualification"}</button>
    </div>;
}

export default function JobPostingForm({ value, onChange, profile, requirements, requirementsEditor, submitting = false, onPublish }) {
    const id = useId();
    const [preview, setPreview] = useState(false);
    const [errors, setErrors] = useState([]);
    const validationRef = useRef(null);
    const details = value.posting_details;
    const qualification = details.required_qualifications;
    const compensation = details.compensation;
    const application = details.application;
    const companyName = jobCompanyName(null, profile);
    const setValue = (key, next) => onChange(previous => ({ ...previous, [key]: next }));
    const setDetails = (key, next) => onChange(previous => ({ ...previous, posting_details: { ...previous.posting_details, [key]: next } }));
    const setGroup = (group, key, next) => onChange(previous => ({ ...previous, posting_details: { ...previous.posting_details, [group]: { ...previous.posting_details[group], [key]: next } } }));
    const toggleBenefit = (group, benefit, checked) => setGroup("benefits", group, checked ? [...details.benefits[group], benefit] : details.benefits[group].filter(item => item !== benefit));
    const field = (name, label, fieldValue, change, props = {}) => <Field key={name} id={`${id}-${name}`} label={label} value={fieldValue} onChange={change} {...props} />;
    const check = () => {
        const issues = validateJobPosting(value, requirements);
        setErrors(issues);
        if (issues.length) { setTimeout(() => validationRef.current?.focus(), 0); return false; }
        return true;
    };
    const submit = async event => {
        event.preventDefault();
        if (submitting || !check()) return;
        if (!preview) { setPreview(true); return; }
        const published = await onPublish();
        if (published) { setPreview(false); setErrors([]); }
    };
    return <form className="job-posting-form" onSubmit={submit} noValidate>
        {errors.length > 0 && <div className="job-posting-errors" role="alert" ref={validationRef} tabIndex={-1}><strong>Please complete the following:</strong><ul>{errors.map((error, index) => <li key={index}>{error}</li>)}</ul></div>}
        {preview ? <>
            <div className="job-posting-preview-heading"><h3>Job Posting Preview</h3><p>Review your announcement before publishing.</p></div>
            <JobPostingAdvertisement job={{ ...jobPostingPayload(value, requirements), User: profile }} requirements={requirements} companyName={companyName} />
            <div className="job-posting-footer"><button type="button" className="job-posting-outline" disabled={submitting} onClick={() => { setPreview(false); setErrors([]); }}>Back to Editing</button><button type="submit" className="job-posting-primary" disabled={submitting}>{submitting ? "Publishing…" : "Publish Job"}</button></div>
        </> : <fieldset disabled={submitting}>
            <Section number="1" title="Basic Job Information" description="Describe the position and where the work will take place.">
                <div className="job-posting-field-grid">
                    {field("title", "Job Title", value.title, next => setValue("title", next), { required: true, maxLength: 255, placeholder: "e.g. Human Resources Assistant" })}
                    {field("location", "Job Location", value.location, next => setValue("location", next), { required: true, maxLength: 255, placeholder: "Full address, city, or work location" })}
                    <Field id={`${id}-employment`} label="Employment Type" required><select id={`${id}-employment`} value={value.employment_type} onChange={event => setValue("employment_type", event.target.value)} required>{EMPLOYMENT_TYPE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>
                    <Field id={`${id}-setup`} label="Work Setup" required><select id={`${id}-setup`} value={details.work_setup} onChange={event => setDetails("work_setup", event.target.value)} required>{WORK_SETUP_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>
                    {field("vacancies", "Number of Vacancies (optional)", details.vacancy_count, next => setDetails("vacancy_count", next), { type: "number", min: 1, max: 100000, step: 1, placeholder: "e.g. 2" })}
                </div>
            </Section>
            <Section number="2" title="About the Company" description="Company identity comes from your authenticated account.">
                <div className="job-posting-field-grid">
                    {field("company", "Company / Organization", companyName, undefined, { readOnly: true, placeholder: "Your organization profile" })}
                    {field("industry", "Industry (optional)", details.industry, next => setDetails("industry", next), { maxLength: 255, placeholder: profile?.EmployerProfile?.industry || "e.g. Hospitality" })}
                    {field("company-description", "Company Description (optional)", details.company_description, next => setDetails("company_description", next), { textarea: true, maxLength: 20000, placeholder: "Tell alumni about your organization." })}
                </div>
            </Section>
            <Section number="3" title="About the Role">
                <div className="job-posting-field-grid">{field("description", "Job Description", value.description, next => setValue("description", next), { required: true, textarea: true, maxLength: 60000, placeholder: "Describe the role and its purpose." })}</div>
                <DynamicList id={`${id}-responsibilities`} label="Key Responsibilities" items={details.responsibilities} onChange={next => setDetails("responsibilities", next)} placeholder="Describe one responsibility" />
            </Section>
            <Section number="4" title="Qualifications" description="Keep required qualifications separate from preferred qualifications and submitted documents.">
                <div className="job-posting-field-grid">
                    {field("education", "Required Education (optional)", qualification.education, next => setGroup("required_qualifications", "education", next), { maxLength: 2000 })}
                    {field("experience", "Required Experience (optional)", qualification.experience, next => setGroup("required_qualifications", "experience", next), { maxLength: 2000 })}
                    {field("program", "Academic Program / Qualification (optional)", value.course_target, next => setValue("course_target", next), { maxLength: 255 })}
                    {field("start-date", "Preferred Start Date (optional)", qualification.preferred_start_date, next => setGroup("required_qualifications", "preferred_start_date", next), { type: "date" })}
                </div>
                <DynamicList id={`${id}-skills`} label="Required Skills" items={qualification.skills} onChange={next => setGroup("required_qualifications", "skills", next)} placeholder="e.g. Communication skills" />
                <DynamicList id={`${id}-other-required`} label="Other Required Qualifications" items={qualification.other} onChange={next => setGroup("required_qualifications", "other", next)} />
                <DynamicList id={`${id}-preferred`} label="Preferred Qualifications" items={details.preferred_qualifications} onChange={next => setDetails("preferred_qualifications", next)} />
            </Section>
            <Section number="5" title="Salary & Benefits" description="Select only the benefits your organization provides.">
                <div className="job-posting-field-grid">
                    <Field id={`${id}-salary-display`} label="Salary Display" required><select id={`${id}-salary-display`} value={compensation.display} onChange={event => setGroup("compensation", "display", event.target.value)}><option value="range">Salary Amount / Range</option><option value="negotiable">Negotiable</option><option value="based-on-experience">Based on Experience</option></select></Field>
                    <Field id={`${id}-salary-period`} label="Salary Period" required><select id={`${id}-salary-period`} value={compensation.period} onChange={event => setGroup("compensation", "period", event.target.value)}><option value="monthly">Monthly</option><option value="daily">Daily</option><option value="hourly">Hourly</option></select></Field>
                    {compensation.display === "range" && <>
                        {field("salary-min", "Salary Minimum (PHP)", compensation.min, next => setGroup("compensation", "min", next), { type: "number", min: 0, step: "0.01" })}
                        {field("salary-max", "Salary Maximum (PHP)", compensation.max, next => setGroup("compensation", "max", next), { type: "number", min: 0, step: "0.01" })}
                    </>}
                </div>
                {[ ["government", "Government Benefits", GOVERNMENT_BENEFITS], ["additional", "Additional Benefits", ADDITIONAL_BENEFITS] ].map(([group, label, options]) => <div className="job-posting-benefits" key={group}><h4>{label}</h4><div>{options.map(benefit => <label key={benefit}><input type="checkbox" checked={details.benefits[group].includes(benefit)} onChange={event => toggleBenefit(group, benefit, event.target.checked)} />{benefit}</label>)}</div></div>)}
                <DynamicList id={`${id}-benefits`} label="Other Benefits" items={details.benefits.other} onChange={next => setGroup("benefits", "other", next)} />
            </Section>
            <Section number="6" title="How to Apply" description="Applications continue through the existing DJEMC portal workflow.">
                <div className="job-posting-field-grid">
                    {field("method", "Application Method", "Apply Through DJEMC Portal", undefined, { readOnly: true })}
                    {field("deadline", "Application Deadline (optional)", application.deadline, next => setGroup("application", "deadline", next), { type: "date" })}
                    {field("instructions", "Additional Application Instructions (optional)", application.instructions, next => setGroup("application", "instructions", next), { textarea: true, maxLength: 10000 })}
                </div>
                <label className="job-posting-contact-choice"><input type="checkbox" checked={application.publish_contact} onChange={event => setGroup("application", "publish_contact", event.target.checked)} />Publish optional contact and walk-in information in this job posting</label>
                {application.publish_contact && <div className="job-posting-field-grid">
                    {field("contact-email", "Contact Email (optional)", application.contact_email, next => setGroup("application", "contact_email", next), { type: "email", maxLength: 255 })}
                    {field("contact-number", "Contact Number (optional)", application.contact_number, next => setGroup("application", "contact_number", next), { type: "tel", maxLength: 80 })}
                    {field("walk-in", "Walk-in Address (optional)", application.walk_in_address, next => setGroup("application", "walk_in_address", next), { maxLength: 1000 })}
                    {field("office-hours", "Office Hours (optional)", application.office_hours, next => setGroup("application", "office_hours", next), { maxLength: 255 })}
                </div>}
            </Section>
            <Section number="7" title="Application Requirements">
                {requirementsEditor}
            </Section>
            <div className="job-posting-footer"><button type="submit" className="job-posting-primary">Preview Job Posting</button></div>
        </fieldset>}
    </form>;
}
