import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

const MOBILE_QUERY = "(max-width: 1024px)";

export function attachPortalDrawerEffects(drawerWindow, drawerDocument, onClose) {
    const media = drawerWindow.matchMedia(MOBILE_QUERY);
    if (!media.matches) {
        onClose();
        return () => {};
    }

    const bodyStyle = drawerDocument.body.style;
    const previousOverflow = bodyStyle.getPropertyValue("overflow");
    const overflowPriority = bodyStyle.getPropertyPriority("overflow");
    const previousPadding = bodyStyle.getPropertyValue("padding-right");
    const paddingPriority = bodyStyle.getPropertyPriority("padding-right");
    const previousActiveElement = drawerDocument.activeElement;
    const scrollbarWidth = Math.max(0, drawerWindow.innerWidth - drawerDocument.documentElement.clientWidth);
    const bodyPadding = parseFloat(drawerWindow.getComputedStyle(drawerDocument.body).paddingRight) || 0;
    let restored = false;
    let cleanedUp = false;

    bodyStyle.setProperty("overflow", "hidden");
    if (scrollbarWidth > 0) {
        bodyStyle.setProperty("padding-right", `${bodyPadding + scrollbarWidth}px`);
    }

    const restoreBody = () => {
        if (restored) return;
        restored = true;
        if (previousOverflow) {
            bodyStyle.setProperty("overflow", previousOverflow, overflowPriority);
        } else {
            bodyStyle.removeProperty("overflow");
        }
        if (previousPadding) {
            bodyStyle.setProperty("padding-right", previousPadding, paddingPriority);
        } else {
            bodyStyle.removeProperty("padding-right");
        }
    };

    const handleKeyDown = (event) => {
        if (event.key === "Escape") {
            event.preventDefault();
            onClose();
        }
    };
    const handleBreakpointChange = (event) => {
        if (!event.matches) {
            restoreBody();
            onClose();
        }
    };

    drawerDocument.addEventListener("keydown", handleKeyDown);
    media.addEventListener("change", handleBreakpointChange);

    return () => {
        if (cleanedUp) return;
        cleanedUp = true;
        drawerDocument.removeEventListener("keydown", handleKeyDown);
        media.removeEventListener("change", handleBreakpointChange);
        restoreBody();
        if (previousActiveElement?.isConnected && typeof previousActiveElement.focus === "function") {
            previousActiveElement.focus({ preventScroll: true });
        }
    };
}

export default function usePortalDrawer({ open, onClose }) {
    const location = useLocation();
    const onCloseRef = useRef(onClose);
    const previousLocationRef = useRef(location.key);

    useEffect(() => {
        onCloseRef.current = onClose;
    }, [onClose]);

    useEffect(() => {
        if (previousLocationRef.current !== location.key) {
            onCloseRef.current();
        }
        previousLocationRef.current = location.key;
    }, [location.key]);

    useEffect(() => {
        if (!open || typeof window === "undefined") return undefined;
        return attachPortalDrawerEffects(window, document, () => onCloseRef.current());
    }, [open]);
}
