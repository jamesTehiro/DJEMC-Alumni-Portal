export const PRODUCTION_API_URL = "https://djemc-alumni-backend.onrender.com/api";

// Used at build time and by the existing client. Reject a development/Hosting
// target explicitly instead of producing a release that sends OTPs there.
export function validateProductionApiUrl(value = PRODUCTION_API_URL) {
    const normalized = String(value || "").trim().replace(/\/+$/, "");
    let url;
    try { url = new URL(normalized); } catch { /* Fail with a configuration message below. */ }
    const host = url?.hostname.toLowerCase() || "";
    if (!url || url.protocol !== "https:" || url.pathname !== "/api" || url.search || url.hash || url.username || url.password
        || !host.includes(".") || /^[\d.]+$/.test(host) || host.includes(":")
        || /(?:^|\.)(?:localhost|local|internal|web\.app|firebaseapp\.com)$/.test(host)) {
        throw new Error("Invalid production VITE_API_BASE_URL. Use the public HTTPS backend URL ending in /api; local addresses and Firebase Hosting are not API servers.");
    }
    return normalized;
}
