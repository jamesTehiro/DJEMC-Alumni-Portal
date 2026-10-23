import React, { useState, useEffect } from "react";
import { Row, Col, Card, Form, Button, InputGroup, Collapse } from "react-bootstrap";
import { FaPlus, FaTrash, FaChevronUp, FaChevronDown, FaUpload, FaUser, FaBriefcase, FaGraduationCap, FaStar, FaProjectDiagram, FaCertificate, FaAward, FaUsers, FaLanguage } from "react-icons/fa";
import ResumePersonalInfo from "./sections/ResumePersonalInfo";
import ResumeSummary from "./sections/ResumeSummary";
import ResumeEducation from "./sections/ResumeEducation";
import ResumeWorkExperience from "./sections/ResumeWorkExperience";
import ResumeSkills from "./sections/ResumeSkills";
import ResumeProjects from "./sections/ResumeProjects";
import ResumeCertifications from "./sections/ResumeCertifications";
import ResumeTrainings from "./sections/ResumeTrainings";
import ResumeSeminars from "./sections/ResumeSeminars";
import ResumeAwards from "./sections/ResumeAwards";
import ResumeOrganizations from "./sections/ResumeOrganizations";
import ResumeVolunteerWork from "./sections/ResumeVolunteerWork";
import ResumeLanguages from "./sections/ResumeLanguages";
import ResumeReferences from "./sections/ResumeReferences";

export default function ResumeEditor({ resume, onChange, errors = {}, onPhotoBusyChange }) {
    const [expandedSections, setExpandedSections] = useState({
        personalInfo: true,
        summary: true,
        education: true,
        workExperience: true,
        skills: true,
        projects: false,
        certifications: false,
        trainings: false,
        seminars: false,
        awards: false,
        organizations: false,
        volunteerWork: false,
        languages: false,
        references: false
    });

    useEffect(() => {
        if (Object.keys(errors).length) setExpandedSections(previous => ({ ...previous, personalInfo: true, ...(errors.skills ? { skills: true } : {}) }));
    }, [errors]);

    const toggleSection = (section) => {
        setExpandedSections(prev => ({
            ...prev,
            [section]: !prev[section]
        }));
    };

    const handleSectionChange = (section, data) => {
        onChange({
            [section]: data
        });
    };

    return (
        <div className="resume-editor">
            <div className="editor-sections">
                {/* Personal Information */}
                <Card className="editor-section-card">
                    <Card.Header className="section-header" onClick={() => toggleSection('personalInfo')}>
                        <div className="section-title">
                            <FaUser /> Personal Information
                        </div>
                        <Button variant="link" size="sm">
                            {expandedSections.personalInfo ? <FaChevronUp /> : <FaChevronDown />}
                        </Button>
                    </Card.Header>
                    <Collapse in={expandedSections.personalInfo}>
                        <Card.Body>
                            <ResumePersonalInfo
                                data={resume.personalInfo || {}}
                                errors={errors}
                                onBusyChange={onPhotoBusyChange}
                                onChange={(data) => handleSectionChange('personalInfo', data)}
                            />
                        </Card.Body>
                    </Collapse>
                </Card>

                {/* Professional Summary */}
                <Card className="editor-section-card">
                    <Card.Header className="section-header" onClick={() => toggleSection('summary')}>
                        <div className="section-title">
                            <FaBriefcase /> Professional Summary
                        </div>
                        <Button variant="link" size="sm">
                            {expandedSections.summary ? <FaChevronUp /> : <FaChevronDown />}
                        </Button>
                    </Card.Header>
                    <Collapse in={expandedSections.summary}>
                        <Card.Body>
                            <ResumeSummary
                                data={resume.summary || {}}
                                onChange={(data) => handleSectionChange('summary', data)}
                            />
                        </Card.Body>
                    </Collapse>
                </Card>

                {/* Education */}
                <Card className="editor-section-card">
                    <Card.Header className="section-header" onClick={() => toggleSection('education')}>
                        <div className="section-title">
                            <FaGraduationCap /> Education
                        </div>
                        <Button variant="link" size="sm">
                            {expandedSections.education ? <FaChevronUp /> : <FaChevronDown />}
                        </Button>
                    </Card.Header>
                    <Collapse in={expandedSections.education}>
                        <Card.Body>
                            <ResumeEducation
                                items={resume.education || []}
                                onChange={(items) => handleSectionChange('education', items)}
                            />
                        </Card.Body>
                    </Collapse>
                </Card>

                {/* Work Experience */}
                <Card className="editor-section-card">
                    <Card.Header className="section-header" onClick={() => toggleSection('workExperience')}>
                        <div className="section-title">
                            <FaBriefcase /> Work Experience
                        </div>
                        <Button variant="link" size="sm">
                            {expandedSections.workExperience ? <FaChevronUp /> : <FaChevronDown />}
                        </Button>
                    </Card.Header>
                    <Collapse in={expandedSections.workExperience}>
                        <Card.Body>
                            <ResumeWorkExperience
                                items={resume.workExperience || []}
                                onChange={(items) => handleSectionChange('workExperience', items)}
                            />
                        </Card.Body>
                    </Collapse>
                </Card>

                {/* Skills */}
                <Card className="editor-section-card">
                    <Card.Header className="section-header" onClick={() => toggleSection('skills')}>
                        <div className="section-title">
                            <FaStar /> Skills
                        </div>
                        <Button variant="link" size="sm">
                            {expandedSections.skills ? <FaChevronUp /> : <FaChevronDown />}
                        </Button>
                    </Card.Header>
                    <Collapse in={expandedSections.skills}>
                        <Card.Body>
                            <ResumeSkills
                                items={resume.skills || []}
                                categories={resume.settings?.skill_categories || []}
                                onChange={(items, categories) => onChange({ skills: items, settings: { ...resume.settings, skill_categories: categories } })}
                            />
                        </Card.Body>
                    </Collapse>
                </Card>

                {/* Projects */}
                <Card className="editor-section-card">
                    <Card.Header className="section-header" onClick={() => toggleSection('projects')}>
                        <div className="section-title">
                            <FaProjectDiagram /> Projects
                        </div>
                        <Button variant="link" size="sm">
                            {expandedSections.projects ? <FaChevronUp /> : <FaChevronDown />}
                        </Button>
                    </Card.Header>
                    <Collapse in={expandedSections.projects}>
                        <Card.Body>
                            <ResumeProjects
                                items={resume.projects || []}
                                onChange={(items) => handleSectionChange('projects', items)}
                            />
                        </Card.Body>
                    </Collapse>
                </Card>

                {/* Certifications */}
                <Card className="editor-section-card">
                    <Card.Header className="section-header" onClick={() => toggleSection('certifications')}>
                        <div className="section-title">
                            <FaCertificate /> Certifications
                        </div>
                        <Button variant="link" size="sm">
                            {expandedSections.certifications ? <FaChevronUp /> : <FaChevronDown />}
                        </Button>
                    </Card.Header>
                    <Collapse in={expandedSections.certifications}>
                        <Card.Body>
                            <ResumeCertifications
                                items={resume.certifications || []}
                                onChange={(items) => handleSectionChange('certifications', items)}
                            />
                        </Card.Body>
                    </Collapse>
                </Card>

                {/* Trainings */}
                <Card className="editor-section-card">
                    <Card.Header className="section-header" onClick={() => toggleSection('trainings')}>
                        <div className="section-title">
                            <FaGraduationCap /> Trainings
                        </div>
                        <Button variant="link" size="sm">
                            {expandedSections.trainings ? <FaChevronUp /> : <FaChevronDown />}
                        </Button>
                    </Card.Header>
                    <Collapse in={expandedSections.trainings}>
                        <Card.Body>
                            <ResumeTrainings
                                items={resume.trainings || []}
                                onChange={(items) => handleSectionChange('trainings', items)}
                            />
                        </Card.Body>
                    </Collapse>
                </Card>

                {/* Seminars */}
                <Card className="editor-section-card">
                    <Card.Header className="section-header" onClick={() => toggleSection('seminars')}>
                        <div className="section-title">
                            <FaUsers /> Seminars
                        </div>
                        <Button variant="link" size="sm">
                            {expandedSections.seminars ? <FaChevronUp /> : <FaChevronDown />}
                        </Button>
                    </Card.Header>
                    <Collapse in={expandedSections.seminars}>
                        <Card.Body>
                            <ResumeSeminars
                                items={resume.seminars || []}
                                onChange={(items) => handleSectionChange('seminars', items)}
                            />
                        </Card.Body>
                    </Collapse>
                </Card>

                {/* Awards */}
                <Card className="editor-section-card">
                    <Card.Header className="section-header" onClick={() => toggleSection('awards')}>
                        <div className="section-title">
                            <FaAward /> Awards & Honors
                        </div>
                        <Button variant="link" size="sm">
                            {expandedSections.awards ? <FaChevronUp /> : <FaChevronDown />}
                        </Button>
                    </Card.Header>
                    <Collapse in={expandedSections.awards}>
                        <Card.Body>
                            <ResumeAwards
                                items={resume.awards || []}
                                onChange={(items) => handleSectionChange('awards', items)}
                            />
                        </Card.Body>
                    </Collapse>
                </Card>

                {/* Organizations */}
                <Card className="editor-section-card">
                    <Card.Header className="section-header" onClick={() => toggleSection('organizations')}>
                        <div className="section-title">
                            <FaUsers /> Organizations
                        </div>
                        <Button variant="link" size="sm">
                            {expandedSections.organizations ? <FaChevronUp /> : <FaChevronDown />}
                        </Button>
                    </Card.Header>
                    <Collapse in={expandedSections.organizations}>
                        <Card.Body>
                            <ResumeOrganizations
                                items={resume.organizations || []}
                                onChange={(items) => handleSectionChange('organizations', items)}
                            />
                        </Card.Body>
                    </Collapse>
                </Card>

                {/* Volunteer Work */}
                <Card className="editor-section-card">
                    <Card.Header className="section-header" onClick={() => toggleSection('volunteerWork')}>
                        <div className="section-title">
                            <FaUsers /> Volunteer Experience
                        </div>
                        <Button variant="link" size="sm">
                            {expandedSections.volunteerWork ? <FaChevronUp /> : <FaChevronDown />}
                        </Button>
                    </Card.Header>
                    <Collapse in={expandedSections.volunteerWork}>
                        <Card.Body>
                            <ResumeVolunteerWork
                                items={resume.volunteerWork || []}
                                onChange={(items) => handleSectionChange('volunteerWork', items)}
                            />
                        </Card.Body>
                    </Collapse>
                </Card>

                {/* Languages */}
                <Card className="editor-section-card">
                    <Card.Header className="section-header" onClick={() => toggleSection('languages')}>
                        <div className="section-title">
                            <FaLanguage /> Languages
                        </div>
                        <Button variant="link" size="sm">
                            {expandedSections.languages ? <FaChevronUp /> : <FaChevronDown />}
                        </Button>
                    </Card.Header>
                    <Collapse in={expandedSections.languages}>
                        <Card.Body>
                            <ResumeLanguages
                                items={resume.languages || []}
                                onChange={(items) => handleSectionChange('languages', items)}
                            />
                        </Card.Body>
                    </Collapse>
                </Card>

                {/* References */}
                <Card className="editor-section-card">
                    <Card.Header className="section-header" onClick={() => toggleSection('references')}>
                        <div className="section-title">
                            <FaUsers /> References
                        </div>
                        <Button variant="link" size="sm">
                            {expandedSections.references ? <FaChevronUp /> : <FaChevronDown />}
                        </Button>
                    </Card.Header>
                    <Collapse in={expandedSections.references}>
                        <Card.Body>
                            <ResumeReferences
                                items={resume.references || []}
                                onChange={(items) => handleSectionChange('references', items)}
                            />
                        </Card.Body>
                    </Collapse>
                </Card>
            </div>
        </div>
    );
}
