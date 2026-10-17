export function membershipSubmittedDate(value) {
    if (!value) return "Not recorded";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Not recorded" : date.toLocaleDateString("en-US", {
        year: "numeric", month: "short", day: "numeric", timeZone: "Asia/Manila"
    });
}

export async function requireMembershipPdf(blob) {
    if (!(blob instanceof Blob)) throw new Error("The server did not return a PDF document.");
    if (blob.type.toLowerCase().includes("json")) {
        let payload;
        try { payload = JSON.parse(await blob.text()); } catch { /* Use the useful fallback below. */ }
        throw new Error(payload?.msg || payload?.message || "Unable to download this application. Please try again.");
    }
    const signature = await blob.slice(0, 5).text();
    if (!blob.type.toLowerCase().includes("application/pdf") || signature !== "%PDF-") {
        throw new Error("PDF generation failed. The server did not return a valid PDF.");
    }
    return blob;
}

export async function waitForMembershipDocumentImages(documentRef) {
    const images = Array.from(documentRef?.images || []);
    await Promise.all(images.map(image => {
        if (image.complete) return Promise.resolve();
        return new Promise(resolve => {
            let timeout;
            const finish = () => {
                clearTimeout(timeout);
                image.removeEventListener("load", finish);
                image.removeEventListener("error", finish);
                resolve();
            };
            image.addEventListener("load", finish, { once: true });
            image.addEventListener("error", finish, { once: true });
            timeout = setTimeout(finish, 5000);
        });
    }));
    await Promise.all(images.map(image => image.decode?.().catch(() => undefined)));
}
