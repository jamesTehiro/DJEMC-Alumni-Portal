import { useEffect } from "react";

// Dynamic viewport units alone do not follow the keyboard in every mobile browser.
export default function useChatViewport() {
    useEffect(() => {
        const viewport = window.visualViewport;
        const root = document.documentElement.style;
        const update = () => root.setProperty("--chat-viewport-height", `${viewport?.height ?? window.innerHeight}px`);
        update();
        viewport?.addEventListener("resize", update);
        window.addEventListener("resize", update);
        return () => {
            viewport?.removeEventListener("resize", update);
            window.removeEventListener("resize", update);
            root.removeProperty("--chat-viewport-height");
        };
    }, []);
}
