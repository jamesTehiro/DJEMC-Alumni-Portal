export const APPLICATION_TOAST_DELAY = 7000;
export const APPLICATION_SUCCESS_TITLE = "Application Submitted Successfully!";
export const APPLICATION_SUCCESS_MESSAGE = "Your application has been submitted successfully. Please wait for the employer to contact you regarding the next steps. You may be contacted within 24 hours, depending on the employer's recruitment process.";

export function validateSubmittedApplication(application, jobId) {
    const applicationId = Number(application?.id);
    const submittedJobId = Number(application?.job_id);
    const expectedJobId = Number(jobId);
    const status = String(application?.status || "").trim().toLowerCase();

    if (!Number.isSafeInteger(applicationId) || applicationId <= 0 ||
        !Number.isSafeInteger(expectedJobId) || expectedJobId <= 0 ||
        submittedJobId !== expectedJobId) {
        throw new Error("The server did not confirm this application. Please check your applications before trying again.");
    }
    if (["rejected", "declined", "cancelled", "canceled"].includes(status)) {
        throw new Error("The application was not accepted. Please check your applications or contact the employer.");
    }
    return application;
}

// A synchronous lock prevents repeated submit events before React renders the busy state.
export async function performApplicationSubmission({ inFlight, jobId, request, onBusy, onSuccess, onFailure }) {
    if (inFlight.current) return false;
    inFlight.current = true;

    try {
        onBusy?.(true);
        let application;
        try {
            application = validateSubmittedApplication(await request(), jobId);
        } catch (failure) {
            onFailure?.(failure);
            return false;
        }
        // UI callbacks run after confirmation, outside the request failure handler.
        onSuccess?.(application);
        return true;
    } finally {
        inFlight.current = false;
        onBusy?.(false);
    }
}
