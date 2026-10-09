import React from "react";
import { normalizeTemplateId } from "../TemplateSelector";

export default function ResumePreviewTemplate({ resume }) {
    const pi = resume?.personalInfo || {};
    const summary = resume?.summary || {};
    const education = resume?.education || [];
    const workExperience = resume?.workExperience || [];
    const skills = resume?.skills || [];
    const projects = resume?.projects || [];
    const certifications = resume?.certifications || [];
    const trainings = resume?.trainings || [];
    const seminars = resume?.seminars || [];
    const awards = resume?.awards || [];
    const organizations = resume?.organizations || [];
    const volunteerWork = resume?.volunteerWork || [];
    const languages = resume?.languages || [];
    const references = resume?.references || [];
    const templateId = normalizeTemplateId(resume?.template_id);

    const hasContent = (arr) => arr && arr.length > 0;
    const renderSection = (title, content) => {
        if (!content) return null;
        return (
            <div className="resume-preview-section">
                <h3 className="section-title">{title}</h3>
                {content}
            </div>
        );
    };

    const renderBody = () => (
        <>
            {renderSection("Professional Summary", summary.content && <p className="summary-text">{summary.content}</p>)}

            {hasContent(workExperience) && renderSection("Work Experience",
                <div className="experience-list">
                    {workExperience.map((exp, idx) => (
                        <div key={idx} className="experience-item">
                            <div className="experience-header">
                                <div className="experience-title">{exp.job_title}</div>
                                <div className="experience-company">{exp.company}</div>
                            </div>
                            <div className="experience-date">
                                {exp.start_date} - {exp.is_current ? "Present" : exp.end_date}
                                {exp.location && <span> • {exp.location}</span>}
                            </div>
                            {exp.description && <p className="experience-description">{exp.description}</p>}
                        </div>
                    ))}
                </div>
            )}

            {hasContent(education) && renderSection("Education",
                <div className="education-list">
                    {education.map((edu, idx) => (
                        <div key={idx} className="education-item">
                            <div className="education-header">
                                <div className="education-degree">{edu.degree}{edu.field_of_study && ` in ${edu.field_of_study}`}</div>
                                <div className="education-school">{edu.institution}</div>
                            </div>
                            <div className="education-date">
                                {edu.start_date} - {edu.is_current ? "Present" : edu.end_date}
                                {edu.gpa && <span> • GPA: {edu.gpa}</span>}
                            </div>
                            {edu.description && <p className="education-description">{edu.description}</p>}
                        </div>
                    ))}
                </div>
            )}

            {hasContent(skills) && renderSection("Skills",
                <div className="skills-list">
                    {skills.map((skill, idx) => (
                        <span key={idx} className="skill-tag">{skill.skill_name || skill.name}</span>
                    ))}
                </div>
            )}

            {hasContent(projects) && renderSection("Projects",
                <div className="projects-list">
                    {projects.map((project, idx) => (
                        <div key={idx} className="project-item">
                            <div className="project-name">{project.project_name || project.name}</div>
                            {project.description && <p>{project.description}</p>}
                            {project.technologies && <p className="project-tech">{project.technologies}</p>}
                        </div>
                    ))}
                </div>
            )}

            {hasContent(certifications) && renderSection("Certifications",
                <div className="certifications-list">
                    {certifications.map((cert, idx) => (
                        <div key={idx} className="certification-item">
                            <div className="cert-name">{cert.name}</div>
                            <div className="cert-issuer">{cert.issuer}</div>
                            {(cert.issue_date || cert.expiry_date) && (
                                <div className="cert-date">
                                    {cert.issue_date} - {cert.expiry_date || "No Expiry"}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {hasContent(trainings) && renderSection("Trainings",
                <div className="trainings-list">
                    {trainings.map((training, idx) => (
                        <div key={idx} className="training-item">
                            <div className="training-name">{training.training_name || training.title}</div>
                            <div className="training-provider">{training.provider}</div>
                        </div>
                    ))}
                </div>
            )}

            {hasContent(awards) && renderSection("Awards & Honors",
                <div className="awards-list">
                    {awards.map((award, idx) => (
                        <div key={idx} className="award-item">
                            <div className="award-title">{award.title}</div>
                            <div className="award-issuer">{award.issuer}</div>
                        </div>
                    ))}
                </div>
            )}

            {hasContent(languages) && renderSection("Languages",
                <div className="languages-list">
                    {languages.map((lang, idx) => (
                        <span key={idx} className="language-item">
                            {lang.language || lang.name} ({lang.proficiency})
                        </span>
                    ))}
                </div>
            )}

            {hasContent(organizations) && renderSection("Organizations",
                <div className="organizations-list">
                    {organizations.map((org, idx) => (
                        <div key={idx} className="organization-item">
                            <div className="organization-name">{org.name || org.organization_name}</div>
                            {org.role && <div className="organization-role">{org.role}</div>}
                        </div>
                    ))}
                </div>
            )}

            {hasContent(volunteerWork) && renderSection("Volunteer Work",
                <div className="volunteer-list">
                    {volunteerWork.map((entry, idx) => (
                        <div key={idx} className="volunteer-item">
                            <div className="volunteer-name">{entry.organization || entry.name}</div>
                            {entry.role && <div className="volunteer-role">{entry.role}</div>}
                        </div>
                    ))}
                </div>
            )}

            {hasContent(references) && renderSection("References",
                <div className="references-list">
                    {references.map((ref, idx) => (
                        <div key={idx} className="reference-item">
                            <div className="reference-name">{ref.name}</div>
                            {ref.position && <div className="reference-role">{ref.position}</div>}
                            {ref.company && <div className="reference-company">{ref.company}</div>}
                        </div>
                    ))}
                </div>
            )}
        </>
    );

    const headerMeta = (
        <div className="contact-info">
            {pi.email && <span>{pi.email}</span>}
            {pi.phone && <span>• {pi.phone}</span>}
            {pi.address && <span>• {pi.address}</span>}
        </div>
    );

    return (
        <div className={`resume-template template-${templateId}`}>
            <div className="resume-header">
                <div className="header-content">
                    <h1 className="name">{pi.full_name || "Your Name"}</h1>
                    {pi.professional_title && <p className="title">{pi.professional_title}</p>}
                    {headerMeta}
                </div>
            </div>

            {renderBody()}
        </div>
    );
}
