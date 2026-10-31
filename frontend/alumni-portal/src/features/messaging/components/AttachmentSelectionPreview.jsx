import React, { useEffect, useState } from "react";
import { FiFile, FiX } from "react-icons/fi";
import { formatAttachmentSize } from "../utils/messageAttachments";
import { isImageAttachment } from "../utils/messageAttachments";

export default function AttachmentSelectionPreview({ file, onRemove }) {
    const [previewUrl, setPreviewUrl] = useState("");
    const isImage = isImageAttachment({ file_mime: file?.type, file_name: file?.name });

    useEffect(() => {
        if (!file || !isImage) return undefined;
        const url = URL.createObjectURL(file);
        setPreviewUrl(url);
        return () => URL.revokeObjectURL(url);
    }, [file, isImage]);

    if (!file) return null;
    return (
        <div className="attachment-preview">
            {previewUrl ? <img className="attachment-selection-image" src={previewUrl} alt={`Preview of ${file.name}`} /> : <FiFile aria-hidden="true" />}
            <div className="attachment-selection-copy"><strong>{file.name}</strong><small>{formatAttachmentSize(file.size)}</small></div>
            <button type="button" onClick={onRemove} aria-label={`Remove ${file.name}`}><FiX /></button>
        </div>
    );
}
