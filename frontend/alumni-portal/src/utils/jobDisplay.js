export function getJobCompanyName(job) {
    const owner = job?.User || job?.user || job?.author || job?.employer;
    return owner?.EmployerProfile?.organization_name || owner?.admin_organization || owner?.name || "Employer";
}

export function getJobPostingMeta(job) {
    let details = job?.posting_details;
    if (typeof details === "string") {
        try { details = JSON.parse(details); } catch { details = null; }
    }
    const workSetup = { "on-site": "On-site", hybrid: "Hybrid", remote: "Remote" }[details?.work_setup] || "";
    const vacancies = Number(details?.vacancy_count);
    return {
        workSetup,
        vacancies: Number.isSafeInteger(vacancies) && vacancies > 0 ? vacancies : null,
        deadline: /^\d{4}-\d{2}-\d{2}$/.test(details?.application?.deadline || "") ? details.application.deadline : ""
    };
}
