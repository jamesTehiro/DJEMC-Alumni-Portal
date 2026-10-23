import React from "react";
import { normalizeTemplateId } from "./resumeTemplateConfig";
import { createResumeSections, getResumeDocumentStyle } from "./resumeTemplateData";

export default function ResumePreviewTemplate({ resume = {} }) {
    const personalInfo = resume.personalInfo || {};
    const templateId = normalizeTemplateId(resume.template_id);
    const sections = createResumeSections(resume);
    const contacts = [personalInfo.email, personalInfo.phone, personalInfo.address].filter(Boolean);
    const links = [...new Set([personalInfo.linkedin, personalInfo.github, personalInfo.portfolio, personalInfo.website].filter(Boolean))];

    return (
        <article className={`djemc-resume-document djemc-resume-${templateId}`} data-template-id={templateId} data-resume-id={resume.id || ""} style={getResumeDocumentStyle(resume)} aria-label={`${personalInfo.full_name || "Your name"} resume`}>
            <header className={`djemc-resume-header${personalInfo.photo_url ? " djemc-resume-header-with-photo" : ""}`}>
                <div className="djemc-resume-heading">
                    <h1 className="djemc-resume-name">{personalInfo.full_name || "Your Name"}</h1>
                    {personalInfo.professional_title && <p className="djemc-resume-professional-title">{personalInfo.professional_title}</p>}
                    {!!contacts.length && <div className="djemc-resume-contacts">{contacts.map((contact, index) => <span key={index}>{contact}</span>)}</div>}
                    {!!links.length && <div className="djemc-resume-links">{links.map(link => <span key={link}>{link}</span>)}</div>}
                </div>
                {personalInfo.photo_url && <img className="djemc-resume-photo" src={personalInfo.photo_url} alt={`${personalInfo.full_name || "Resume"} profile`} />}
            </header>
            <div className="djemc-resume-body">
                {sections.map(section => (
                    <section className={`djemc-resume-section djemc-resume-section-${section.kind}`} key={section.id} data-section-id={section.id}>
                        <h2 className="djemc-resume-section-heading">{section.title}</h2>
                        <div className="djemc-resume-section-entries">
                            {section.items.map((item, index) => (
                                <div className={`djemc-resume-entry${item.categoryHeading ? " djemc-resume-skill-start" : ""}`} key={index}>
                                    {item.categoryHeading && <h3 className="djemc-resume-skill-category">{item.categoryHeading}</h3>}
                                    {item.categoryHeading ? <div className="djemc-resume-entry"><h3 className="djemc-resume-entry-title">{item.title}</h3></div> : item.title && <h3 className="djemc-resume-entry-title">{item.title}</h3>}
                                    {item.subtitle && <p className="djemc-resume-entry-subtitle">{item.subtitle}</p>}
                                    {item.meta && <p className="djemc-resume-entry-meta">{item.meta}</p>}
                                    {item.description && <p className="djemc-resume-entry-description">{item.description}</p>}
                                    {item.details?.filter(Boolean).map((detail, detailIndex) => <p className="djemc-resume-entry-detail" key={detailIndex}>{detail}</p>)}
                                </div>
                            ))}
                        </div>
                    </section>
                ))}
            </div>
        </article>
    );
}
