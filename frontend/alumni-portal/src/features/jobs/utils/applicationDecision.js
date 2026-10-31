import { declineConfirmation } from "./applicationStatus.js";

export const canDecideApplication = (application, processing = false) => !processing &&
    Boolean(application?.id) && ["pending", "pending_review", "submitted"].includes(String(application.status || "").toLowerCase());

export async function saveApplicationDecision(application, status, api, confirmDecline) {
    if (!canDecideApplication(application)) return null;
    if (status === "not_verified" && !confirmDecline(declineConfirmation)) return null;
    return api.put(`/applications/${application.id}/review`, {
        status,
        job_id: application.job_id || application.Job?.id,
        recruitment_cycle: application.recruitment_cycle
    }, true);
}

export function updateActiveApplications(records, applicationId, status) {
    return records.flatMap(application => Number(application.id) !== Number(applicationId)
        ? [application]
        : status === "not_verified" ? [] : [{ ...application, status }]);
}
