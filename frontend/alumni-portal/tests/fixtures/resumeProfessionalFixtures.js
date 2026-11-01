const identity = {
    id: 41, title: "Professional Resume", template_id: "modern-professional", font_size: 10, line_spacing: 1.4,
    personalInfo: { full_name: "Alex Dela Cruz", professional_title: "Information Technology Graduate", email: "alex@example.invalid", phone: "+63 912 345 6789", address: "Cebu City, Philippines" },
    settings: { client_draft_id: "professional-templates", preserved_setting: true },
    summary: { content: "Detail-oriented graduate developing reliable software and supporting community technology initiatives." },
    education: [{ degree: "Bachelor of Science", field_of_study: "Information Technology", institution: "Don Jose Ecleo Memorial College", start_date: "2022-08-01", end_date: "2026-06-01", description: "Capstone focused on accessible community services." }],
    workExperience: [], skills: [{ skill_name: "JavaScript", category: "Programming" }, { skill_name: "React", category: "Programming" }, { skill_name: "Git", category: "Tools" }],
    projects: [{ project_name: "Community Services Portal", technologies: "React, Node.js, MySQL", description: "Built accessible workflows and tested search, record updates and mobile views." }],
    certifications: [{ name: "Web Development Certificate", issuer: "Learning Center", issue_date: "2026-04-01", credential_id: "WEB-2026" }],
    trainings: [{ training_name: "Software Development Internship", provider: "Community Technology Office", completion_date: "2026-05-01", description: "Practiced software testing, collaboration and technical documentation." }],
    seminars: [{ seminar_name: "Accessible Web Design", organizer: "Technology Society", date: "2026-03-01", location: "Cebu City" }],
    awards: [{ title: "Capstone Recognition", issuer: "DJEMC", date: "2026-06-01" }],
    organizations: [{ organization_name: "Information Technology Society", position: "Member", start_date: "2023-08-01", end_date: "2026-06-01" }],
    volunteerWork: [{ organization: "Community Learning Center", role: "Digital Literacy Volunteer", description: "Assisted learners with basic computer skills." }],
    languages: [{ language: "English", proficiency: "Professional" }, { language: "Filipino", proficiency: "Native" }],
    references: [{ name: "Maria Santos", relationship: "Internship Supervisor", company: "Community Technology Office", email: "maria@example.invalid" }]
};

const jobs = Array.from({ length: 5 }, (_, index) => ({ job_title: `Software Developer ${index + 1}`, company: `Technology Company ${index + 1}`, location: "Cebu City", start_date: `202${index}-01-01`, end_date: `202${index}-12-01`, description: "Delivered reliable application features, reviewed requirements and improved automated checks with the development team." }));

export const resumeScenarios = {
    graduate: { ...identity },
    experienced: { ...identity, personalInfo: { ...identity.personalInfo, professional_title: "Senior Software Developer" }, workExperience: jobs },
    bsit: { ...identity, projects: [...identity.projects, { project_name: "Application Monitoring Dashboard", technologies: "Node.js, MySQL", description: "Tracked service health and documented useful operational metrics." }], certifications: [...identity.certifications, { name: "Database Fundamentals", issuer: "Professional Learning Center", issue_date: "2026-02-01" }] },
    learning: { ...identity, trainings: Array.from({ length: 24 }, (_, index) => ({ training_name: `Professional Training ${index + 1}`, provider: "Learning Center", completion_date: "2026-02-01", description: `Training achievement ${index + 1}: practiced hands-on technical and professional skills.` })), seminars: Array.from({ length: 20 }, (_, index) => ({ seminar_name: `Career Seminar ${index + 1}`, organizer: "Career Office", date: "2026-01-01", description: `Seminar insight ${index + 1}: explored current professional practices.` })) },
    extended: { ...identity, workExperience: [...jobs, { job_title: "Detailed Career Assignment", company: "Community Technology Office", description: "Documented responsibilities, outcomes and collaboration across a complex professional assignment. ".repeat(160) }] },
    empty: { ...identity, summary: { content: "   " }, education: [{}], workExperience: [], skills: [{ skill_name: "" }], projects: [null, {}], certifications: [], trainings: [{}], seminars: [], awards: [], organizations: [], volunteerWork: [], languages: [], references: [] }
};
