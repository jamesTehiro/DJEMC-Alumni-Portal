import React, { useEffect, useRef, useState } from "react";
import { Button, Modal, Spinner } from "react-bootstrap";
import { FiDownload, FiFile, FiImage } from "react-icons/fi";
import { fetchFile } from "../services/api";
import { formatAttachmentSize, isImageAttachment } from "../utils/messageAttachments";
import DocumentPreview from "./DocumentPreview";
import { prepareDocumentBlob } from "../utils/documentPreview";

export default function MessageAttachment({ message, openAttachment }) {
    const [previewUrl, setPreviewUrl] = useState("");
    const [imageState, setImageState] = useState("idle");
    const [imageError, setImageError] = useState("");
    const [showPreview, setShowPreview] = useState(false);
    const [previewBlob, setPreviewBlob] = useState(null);
    const imageButtonRef = useRef(null);
    const image = isImageAttachment(message);
    const name = message?.file_name || "Shared file";
    const size = formatAttachmentSize(message?.file_size);

    useEffect(() => {
        if (!image || !message?.file_url) return undefined;
        let active = true;
        let objectUrl = "";
        let observer;
        setImageState("idle");
        setImageError("");
        setPreviewUrl("");
        const load = () => {
            if (!active) return;
            setImageState("loading");
            fetchFile(message.file_url, true).then(prepareDocumentBlob).then(({ blob, image: actualImage }) => {
                if (!active) return;
                setPreviewBlob(blob);
                if (!actualImage) { setImageState("document"); return; }
                objectUrl = URL.createObjectURL(blob);
                setPreviewUrl(objectUrl);
                setImageState("loaded");
            }).catch((error) => {
                if (active) { setImageState("error"); setImageError(error.message); }
            });
        };
        if (typeof IntersectionObserver === "function" && imageButtonRef.current) {
            observer = new IntersectionObserver((entries) => {
                if (entries.some((entry) => entry.isIntersecting)) {
                    observer.disconnect();
                    load();
                }
            }, { rootMargin: "160px" });
            observer.observe(imageButtonRef.current);
        } else load();
        return () => {
            active = false;
            observer?.disconnect();
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [image, message?.file_url]);

    const downloadImage = () => {
        if (!previewUrl) return;
        const link = document.createElement("a");
        link.href = previewUrl;
        link.download = name;
        document.body.appendChild(link);
        link.click();
        link.remove();
    };

    if (image) {
        if (imageState === "document") return <>
            <button type="button" className="attachment-action" onClick={() => setShowPreview(true)}><FiFile /> Open {name}</button>
            <Modal show={showPreview} onHide={() => setShowPreview(false)} centered size="xl"><Modal.Header closeButton><Modal.Title>{name}</Modal.Title></Modal.Header><Modal.Body>{showPreview && <DocumentPreview blob={previewBlob} name={name} />}</Modal.Body></Modal>
        </>;
        return (
            <>
                <div className="message-attachment is-image">
                    {imageState === "error" ? (
                        <div className="attachment-image-fallback" role="status">
                            <FiImage aria-hidden="true" />
                            <span>{imageError || "Attachment is no longer available."}</span>
                        </div>
                    ) : (
                        <button ref={imageButtonRef} type="button" className="attachment-image-button" onClick={() => previewUrl && setShowPreview(true)} aria-label="Open image preview" disabled={!previewUrl}>
                            {previewUrl ? <img loading="lazy" src={previewUrl} alt="Image attachment" onError={() => setImageState("error")} /> : imageState === "loading" ? <span className="attachment-image-placeholder" role="status"><Spinner animation="border" size="sm" aria-hidden="true" /> Loading image…</span> : <span className="attachment-image-placeholder"><FiImage aria-hidden="true" /> Image attachment</span>}
                        </button>
                    )}
                </div>
                <Modal show={showPreview} onHide={() => setShowPreview(false)} centered size="xl" dialogClassName="message-image-preview-dialog" contentClassName="message-image-preview-content" aria-label="Image preview">
                    <Modal.Header closeButton className="message-image-preview-header">
                        <Modal.Title>Image preview</Modal.Title>
                        <Button type="button" variant="light" onClick={downloadImage} aria-label="Download image"><FiDownload /></Button>
                    </Modal.Header>
                    <Modal.Body>{showPreview && <DocumentPreview blob={previewBlob} name={name} />}</Modal.Body>
                </Modal>
            </>
        );
    }

    return (
        <><div className="message-attachment">
            <div className="attachment-file-row">
                <FiFile aria-hidden="true" />
                <div className="attachment-file-copy"><strong title={name}>{name}</strong><small>{message?.file_mime || "File"}{size ? ` · ${size}` : ""}</small></div>
                <button type="button" className="attachment-action" onClick={() => setShowPreview(true)}>{"Open"}</button>
                <button type="button" className="attachment-action" onClick={() => openAttachment(message, "download")} aria-label={`Download ${name}`}><FiDownload /></button>
            </div>
        </div>
        <Modal show={showPreview} onHide={() => setShowPreview(false)} centered size="xl"><Modal.Header closeButton><Modal.Title>{name}</Modal.Title></Modal.Header><Modal.Body>{showPreview && <DocumentPreview path={message?.file_url || message?.attachment} name={name} />}</Modal.Body></Modal>
        </>
    );
}
