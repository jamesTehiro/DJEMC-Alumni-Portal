import React from "react";
import { Button } from "react-bootstrap";
import { MEMBERSHIP_PERSONAL_FIELDS, MEMBERSHIP_ROW_FIELDS, MEMBERSHIP_SECTIONS,
    ageFromBirthDate, membershipEducationReviewValue, membershipPayload } from "../../utils/membershipApplication";
import "./MembershipReview.css";

export default function MembershipReview({ application, onEdit, consentText = "", showConsent = true }) {
    const data = membershipPayload(application);
    const personal = data.personal_details;
    return <div className="membership-review">
        {MEMBERSHIP_SECTIONS.map((section, index) => <section className="membership-review-section" key={section.key}>
            <header>
                <h3>{section.numeral}. {section.title}</h3>
                {onEdit && <Button type="button" variant="outline-success" size="sm" onClick={() => onEdit(index)}>Edit section</Button>}
            </header>
            {index === 0 ? <dl className="membership-review-details">
                {MEMBERSHIP_PERSONAL_FIELDS.map(field => <div key={field.key}>
                    <dt>{field.label}</dt><dd>{personal[field.key] || <span className="membership-not-provided">Not provided</span>}</dd>
                </div>)}
                <div><dt>Age (calculated)</dt><dd>{ageFromBirthDate(personal.date_of_birth) !== "" ? ageFromBirthDate(personal.date_of_birth) : "Not provided"}</dd></div>
            </dl> : data[section.key].length ? <div className={`membership-review-table-scroll${section.key === "educational_attainment" ? " membership-review-education" : ""}`}
                role="region" aria-label={`${section.title} review table`} tabIndex={0}>
                <table>
                    <caption className="visually-hidden">{section.title}</caption>
                    <thead><tr>{section.key === "educational_attainment" && <th scope="col">Education Level / School</th>}{MEMBERSHIP_ROW_FIELDS[section.key].slice(section.key === "educational_attainment" ? 2 : 0).map(field => <th scope="col" key={field.key}>{field.label}</th>)}</tr></thead>
                    <tbody>{data[section.key].map((row, rowIndex) => <tr key={rowIndex}>
                        {section.key === "educational_attainment" && <th scope="row">{row.level}<br />{membershipEducationReviewValue(row, "school_name")}</th>}
                        {MEMBERSHIP_ROW_FIELDS[section.key].slice(section.key === "educational_attainment" ? 2 : 0).map(field => <td data-label={field.label} key={field.key}>{section.key === "educational_attainment" ? membershipEducationReviewValue(row, field.key) : row[field.key] || "—"}</td>)}
                    </tr>)}</tbody>
                </table>
            </div> : <p className="membership-not-provided">
                {section.emptyFlag && data.options[section.emptyFlag] ? `No ${section.title.toLowerCase()} declared.` : "No entries provided."}
            </p>}
        </section>)}
        {showConsent && (application?.consent_accepted || application?.submitted_at) && <section className="membership-review-section membership-review-consent">
            <h3>Consent acknowledgement</h3>
            <p>{application.consent_text || consentText}</p>
            <p><strong>Consent accepted:</strong> {application.consent_accepted ? "Yes" : "Not recorded"}</p>
            {application.consent_accepted_at && <p><strong>Accepted on:</strong> {new Date(application.consent_accepted_at).toLocaleString()}</p>}
            {application.submitted_at && <p><strong>Submitted on:</strong> {new Date(application.submitted_at).toLocaleString()}</p>}
            {application.consent_version && <p><strong>Declaration version:</strong> {application.consent_version}</p>}
        </section>}
    </div>;
}
