import { getApplicantResumeDocument, getApplicantDocumentFilename, getApplicantResumeFileUrl, getApplicantResumePreviewType } from "./applicantResume.js";

export async function openApplicantResumePrintView(application, {
    fetchDocument,
    openWindow = () => window.open("", "_blank", "width=980,height=820"),
    createObjectURL = URL.createObjectURL,
    revokeObjectURL = URL.revokeObjectURL,
    watchClosed = callback => setInterval(callback, 1000),
    stopWatching = clearInterval,
}) {
    const document = getApplicantResumeDocument(application);
    const path = getApplicantResumeFileUrl(application?.id, document);
    if (!path) throw new Error("No uploaded resume is available to print.");
    // Open synchronously from the click so popup protection doesn't block it
    // after the authenticated request completes. No applicant HTML is copied.
    const popup = openWindow();
    if (!popup) throw new Error("Allow popups to open the resume for printing.");
    let url;
    try {
        popup.opener = null;
        popup.document.title = getApplicantDocumentFilename(document);
        popup.document.body.textContent = "Preparing the uploaded resume for printing…";
        const blob = await fetchDocument(path, true);
        const mime = String(blob?.type || "").split(";")[0];
        if (!blob?.size || /^(text\/html|application\/(json|xhtml\+xml))$/.test(mime) || mime.endsWith("+json")) throw new Error("The server did not return the uploaded resume.");
        const type = getApplicantResumePreviewType(document, blob);
        if (type === "file") throw new Error("This resume format cannot be printed in the browser. Download it and print from a compatible application.");
        if (popup.closed) return;
        url = createObjectURL(type === "pdf" && mime !== "application/pdf" ? new Blob([blob], { type: "application/pdf" }) : blob);
        popup.location.replace(url);
        popup.focus();
        // The new tab contains only the actual file and the browser's print UI.
        const timer = watchClosed(() => {
            if (popup.closed) { stopWatching(timer); revokeObjectURL(url); }
        });
        return { url, popup };
    } catch (error) {
        if (url) revokeObjectURL(url);
        popup.close();
        throw error;
    }
}
