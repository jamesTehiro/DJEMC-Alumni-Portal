import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FiMoreHorizontal, FiTrash2 } from "react-icons/fi";

export default function MessageOptionsMenu({ open, onToggle, onClose, onDelete }) {
    const triggerRef = useRef(null);
    const menuRef = useRef(null);
    const deleteRef = useRef(null);
    const [position, setPosition] = useState(null);
    const onCloseRef = useRef(onClose);
    useEffect(() => {
        onCloseRef.current = onClose;
    }, [onClose]);

    useLayoutEffect(() => {
        if (!open) return undefined;

        const handlePointerDown = (event) => {
            if (triggerRef.current?.contains(event.target) || menuRef.current?.contains(event.target)) return;
            onCloseRef.current();
        };
        const handleKeyDown = (event) => {
            if (event.key === "Escape") {
                event.stopPropagation();
                onCloseRef.current();
                triggerRef.current?.focus();
            }
        };
        const handleViewportChange = () => onCloseRef.current();

        document.addEventListener("pointerdown", handlePointerDown, true);
        document.addEventListener("keydown", handleKeyDown, true);
        window.addEventListener("resize", handleViewportChange);
        window.addEventListener("scroll", handleViewportChange, true);
        return () => {
            document.removeEventListener("pointerdown", handlePointerDown, true);
            document.removeEventListener("keydown", handleKeyDown, true);
            window.removeEventListener("resize", handleViewportChange);
            window.removeEventListener("scroll", handleViewportChange, true);
        };
    }, [open]);

    useLayoutEffect(() => {
        if (open && position) deleteRef.current?.focus();
    }, [open, position]);

    return (
        <>
            <button
                ref={triggerRef}
                type="button"
                className="message-options-trigger"
                aria-label="Message options"
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={(event) => {
                    event.stopPropagation();
                    if (!open) {
                        const rect = triggerRef.current?.getBoundingClientRect();
                        if (rect) {
                            const menuWidth = 168;
                            const right = Math.max(8, Math.min(window.innerWidth - rect.right, window.innerWidth - menuWidth - 8));
                            const top = Math.min(rect.bottom + 4, window.innerHeight - 48);
                            setPosition({ top, right });
                        }
                    }
                    onToggle();
                }}
            >
                <FiMoreHorizontal aria-hidden="true" />
            </button>
            {open && position && createPortal(
                <div ref={menuRef} className="message-options-menu" role="menu" style={position}>
                    <button
                        ref={deleteRef}
                        type="button"
                        className="message-options-delete"
                        role="menuitem"
                        onClick={(event) => {
                            event.stopPropagation();
                            onClose();
                            onDelete();
                        }}
                    >
                        <FiTrash2 aria-hidden="true" />
                        <span>Delete message</span>
                    </button>
                </div>,
                document.body
            )}
        </>
    );
}
