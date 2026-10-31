import React from "react";
import { Card, ProgressBar, Alert, ListGroup } from "react-bootstrap";

export default function ResumeScorePanel({ resume }) {
    if (!resume) return <div className="score-empty">No resume selected</div>;

    const calculateScore = () => {
        let total = 0;
        let filled = 0;
        const missing = [];

        // Personal Info (20%)
        total += 20;
        const pi = resume.personalInfo || {};
        let personalInfoScore = 0;
        if (pi.full_name) personalInfoScore += 5;
        if (pi.email) personalInfoScore += 5;
        if (pi.phone) personalInfoScore += 5;
        if (pi.address) personalInfoScore += 5;
        filled += personalInfoScore;
        if (personalInfoScore < 20) missing.push("Personal Information");

        // Summary (10%)
        total += 10;
        if (resume.summary?.content) filled += 10;
        else missing.push("Professional Summary");

        // Education (15%)
        total += 15;
        if (resume.education?.length > 0) filled += 15;
        else missing.push("Education");

        // Work Experience (20%)
        total += 20;
        if (resume.workExperience?.length > 0) filled += 20;
        else missing.push("Work Experience");

        // Skills (15%)
        total += 15;
        if (resume.skills?.length > 0) filled += 15;
        else missing.push("Skills");

        // Other sections (20%)
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
        if (filledSections < 3) missing.push("Additional Sections (certifications, projects, etc.)");

        const percentage = Math.round((filled / total) * 100);
        return { percentage, missing };
    };

    const { percentage, missing } = calculateScore();

    const getScoreColor = (score) => {
        if (score >= 80) return "success";
        if (score >= 60) return "warning";
        return "danger";
    };

    return (
        <div className="resume-score-panel">
            <Card>
                <Card.Header className="score-header">
                    <h5>Resume Score</h5>
                </Card.Header>
                <Card.Body>
                    <div className="score-circle">
                        <div className={`score-value text-${getScoreColor(percentage)}`}>
                            {percentage}%
                        </div>
                        <div className="score-label">Completion</div>
                    </div>

                    <ProgressBar now={percentage} variant={getScoreColor(percentage)} className="mb-3" />

                    {missing.length > 0 && (
                        <Alert variant="info" className="mt-3">
                            <h6>Missing Sections:</h6>
                            <ListGroup variant="flush">
                                {missing.map((item, idx) => (
                                    <ListGroup.Item key={idx} className="missing-item">
                                        {item}
                                    </ListGroup.Item>
                                ))}
                            </ListGroup>
                        </Alert>
                    )}

                    {percentage >= 80 && (
                        <Alert variant="success" className="mt-3">
                            Great job! Your resume looks complete and ATS-friendly.
                        </Alert>
                    )}
                </Card.Body>
            </Card>
        </div>
    );
}
