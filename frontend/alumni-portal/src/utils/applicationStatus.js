export const APPROVED_LABEL = "APPROVED";
export const declineConfirmation = "Decline this application? It will be removed from the active applicant list for this job. The application and submitted documents will be retained.";

export const applicationStatusLabel = status => status === "verified" ? APPROVED_LABEL : status === "not_verified" ? "DECLINED" : String(status || "pending").replaceAll("_", " ").toUpperCase();
