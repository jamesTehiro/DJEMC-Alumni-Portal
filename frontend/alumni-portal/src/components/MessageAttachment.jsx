import React, { useEffect, useState } from "react";
import { FiDownload, FiFile, FiImage } from "react-icons/fi";
import { fetchFile } from "../services/api";
import { formatAttachmentSize, isImageAttachment } from "../utils/messageAttachments";

export default function MessageAttachment({ message, openAttachment }) {
    const [previewUrl, setPreviewUrl] = useState("");
    const image = isImageAttachment(message);
    const name = message?.file_name || "Shared file";
    const size = formatAttachmentSize(message?.file_size);

    useEffect(() => {
        if (!image || !message?.file_url) return undefined;
        let active = true;
        let objectUrl = "";
        fetchFile(message.file_url, true).then((blob) => {
            if (!active) return;
            objectUrl = URL.createObjectURL(blob);
            setPreviewUrl(objectUrl);
        }).catch(() => {
            if (active) setPreviewUrl("");
        });
        return () => {
            active = false;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [image, message?.file_url]);

    return (
        <div className={`message-attachment${image ? " is-image" : ""}`}>
            {image && (
                <button type="button" className="attachment-image-button" onClick={() => openAttachment(message)} aria-label={`Preview ${name}`}>
                    {previewUrl ? <img src={previewUrl} alt={name} /> : <span className="attachment-image-placeholder"><FiImage /> Loading image…</span>}
                </button>
            )}
            <div className="attachment-file-row">
                <FiFile aria-hidden="true" />
                <div className="attachment-file-copy"><strong title={name}>{name}</strong><small>{message?.file_mime || "File"}{size ? ` · ${size}` : ""}</small></div>
                <button type="button" className="attachment-action" onClick={() => openAttachment(message)}>{image ? "Preview" : "Open"}</button>
                <button type="button" className="attachment-action" onClick={() => openAttachment(message, "download")} aria-label={`Download ${name}`}><FiDownload /></button>
            </div>
        </div>
    );
}
