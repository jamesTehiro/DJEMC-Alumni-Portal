export const APPROVED_LABEL = "FOR INTERVIEW";
export const declineConfirmation = "Decline this application? It will be removed from the active applicant list for this job. The application and submitted documents will be retained.";

export const applicationStatusLabel = status => {
    const value = String(status || "pending").toLowerCase();
    if (["verified", "approved", "ready_for_interview"].includes(value)) return APPROVED_LABEL;
    if (["pending", "pending_review", "submitted"].includes(value)) return "PENDING REVIEW";
    return value === "not_verified" ? "DECLINED" : String(status).replaceAll("_", " ").toUpperCase();
};
