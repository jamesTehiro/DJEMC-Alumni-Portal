export const RESUME_TEMPLATE_OPTIONS = [
    { id: "modern-professional", name: "Modern Professional", description: "A structured two-column layout with a green section rail.", layout: "Two columns · Modern" },
    { id: "executive-corporate", name: "Executive Corporate", description: "Formal typography, a centered heading and refined separators.", layout: "Single column · Formal" },
    { id: "university-green", name: "University Green Theme", description: "A confident DJEMC green header with clear academic sections.", layout: "Single column · DJEMC green" },
    { id: "minimal-black-white", name: "Minimal Black & White", description: "An understated black and white design with generous spacing.", layout: "Single column · Minimal" },
    { id: "creative-professional", name: "Creative Professional", description: "A distinctive green heading and balanced columns of content.", layout: "Two columns · Creative" }
];

export function normalizeTemplateId(templateId) {
    const cleaned = String(templateId || "university-green").trim().toLowerCase();
    const normalized = cleaned.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const aliases = { "university-green-theme": "university-green", "minimal-black-white": "minimal-black-white" };
    const found = RESUME_TEMPLATE_OPTIONS.find(option =>
        option.id === (aliases[normalized] || normalized) ||
        option.id.replace(/-/g, "") === normalized.replace(/-/g, "")
    );
    return found?.id || "university-green";
}

export const RESUME_TEMPLATE_SAMPLE = {
    font_size: 10,
    line_spacing: 1.4,
    personalInfo: { full_name: "Alex Dela Cruz", professional_title: "Business Administration Graduate", email: "alex.delacruz@example.com", phone: "+63 912 345 6789", address: "Manila, Philippines" },
    summary: { content: "Organized and service-oriented graduate with experience in office administration, team coordination and community projects. Committed to thoughtful, dependable work." },
    workExperience: [{ job_title: "Administrative Intern", company: "Community Services Office", location: "Manila", start_date: "2025-01-01", end_date: "2025-06-01", description: "Coordinated records and daily office requests. Supported a team of eight with reports, schedules and community activities." }],
    education: [{ degree: "Bachelor of Science", field_of_study: "Business Administration", institution: "Don Jose Ecleo Memorial College", start_date: "2021-08-01", end_date: "2025-06-01", description: "Graduated with a focus on management and professional communication." }],
    skills: [{ skill_name: "Office administration" }, { skill_name: "Communication" }, { skill_name: "Microsoft Office" }, { skill_name: "Project coordination" }],
    projects: [{ project_name: "Community Resource Directory", description: "Created a practical reference for local services and volunteer opportunities." }],
    certifications: [{ name: "Professional Development Certificate", issuer: "Learning & Development Center", issue_date: "2025-03-01" }],
    languages: [{ language: "English", proficiency: "Professional" }, { language: "Filipino", proficiency: "Native" }]
};
