import { declineConfirmation } from "./applicationStatus.js";

export async function saveApplicationDecision(application, status, api, confirmDecline) {
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
