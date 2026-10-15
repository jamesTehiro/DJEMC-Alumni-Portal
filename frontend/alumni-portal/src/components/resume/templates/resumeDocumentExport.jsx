import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ResumePreviewTemplate from "./ResumePreviewTemplate";
import { paginateResumeDocument } from "./paginateResumeDocument";
import { API_BASE_URL, resolveFileUrl } from "../../../services/api";
import resumeCss from "../ResumeTemplates.css?raw";

const photoDataUrl = /^data:image\/(?:jpeg|png|webp|gif);base64,/i;

async function inlinePhoto(resume) {
    const photo = resume.personalInfo?.photo_url;
    if (!photo) return resume;
    if (photoDataUrl.test(photo)) return resume;
    const resolved = resolveFileUrl(photo);
    const photoUrl = new URL(resolved, window.location.href);
    if (!["http:", "https:", "blob:"].includes(photoUrl.protocol)) throw new Error("The profile photo could not be included in the PDF.");
    const apiUrl = new URL(API_BASE_URL, window.location.href);
    const headers = {};
    const token = localStorage.getItem("token");
    if (token && photoUrl.origin === apiUrl.origin) headers.Authorization = `Bearer ${token}`;
    let response;
    try {
        response = await fetch(photoUrl.href, { headers, credentials: photoUrl.origin === apiUrl.origin ? "same-origin" : "omit" });
    } catch {
        throw new Error("The profile photo could not be loaded for the PDF. Re-upload the photo and try again.");
    }
    if (!response.ok) throw new Error("The profile photo could not be loaded for the PDF. Re-upload the photo and try again.");
    const blob = await response.blob();
    if (!/^image\/(jpeg|png|webp|gif)$/i.test(blob.type)) throw new Error("Use a JPG, PNG, WebP or GIF profile photo to download the PDF.");
    if (blob.size > 1024 * 1024) throw new Error("Re-upload the profile photo to reduce its size before downloading the PDF.");
    const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("The profile photo could not be read for the PDF."));
        reader.readAsDataURL(blob);
    });
    return { ...resume, personalInfo: { ...resume.personalInfo, photo_url: dataUrl } };
}

export async function buildResumeDocumentHtml(resume) {
    const preparedResume = await inlinePhoto(resume);
    await document.fonts?.ready;
    const stage = document.createElement("div");
    stage.className = "djemc-resume-measurement";
    stage.setAttribute("aria-hidden", "true");
    const style = document.createElement("style");
    style.textContent = resumeCss;
    const sourceHost = document.createElement("div");
    sourceHost.innerHTML = renderToStaticMarkup(<ResumePreviewTemplate resume={preparedResume} />);
    const source = sourceHost.querySelector(".djemc-resume-document");
    stage.append(style, source);
    document.body.appendChild(stage);
    try {
        const pages = paginateResumeDocument(source, stage);
        const title = String(preparedResume.personalInfo?.full_name || preparedResume.title || "Resume").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
        return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>@page { size: A4; margin: 0; } html, body { margin: 0; padding: 0; background: white; } ${resumeCss}</style></head><body>${pages.map(page => page.outerHTML).join("")}</body></html>`;
    } finally {
        stage.remove();
    }
}
