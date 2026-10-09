import React from "react";
import AdminEmployerPage from "../AdminEmployerPage";

export default function AdminEmployerApplicantsPage() {
    return (
        <AdminEmployerPage
            title="Employer Applicant Management"
            subtitle="Review job applications, track candidate activity, and manage applicant outcomes."
            eyebrow="Applicant Management"
            showOverviewSections={false}
        />
    );
}
