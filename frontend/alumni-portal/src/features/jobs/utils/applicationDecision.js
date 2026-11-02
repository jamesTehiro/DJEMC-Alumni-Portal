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

export function applicationDecisionFeedback(result) {
    const decision = result.msg || "Application updated.";
    switch (result.email?.status) {
        case "queued": return `${decision} Gmail notification queued for delivery.`;
        case "processing": return `${decision} Gmail notification is being processed.`;
        case "sent": return `${decision} Email accepted by the email provider; inbox delivery is not confirmed.`;
        case "failed": return `${decision} ${result.email.reason === "enqueue_failed"
            ? "Gmail notification could not be queued. Contact support."
            : result.email.reason ? "Gmail notification is unavailable for this registered account. Contact support."
                : "Gmail notification failed. Contact support."}`;
        default: return decision;
    }
}

export function updateActiveApplications(records, applicationId, status) {
    return records.flatMap(application => Number(application.id) !== Number(applicationId)
        ? [application]
        : status === "not_verified" ? [] : [{ ...application, status }]);
}
