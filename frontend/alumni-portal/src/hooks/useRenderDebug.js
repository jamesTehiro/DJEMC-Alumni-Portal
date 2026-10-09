import { useEffect, useRef } from "react";

const mountCounts = new Map();

export default function useRenderDebug(label) {
    const renderCount = useRef(0);
    renderCount.current += 1;

    if (import.meta.env.DEV) {
        console.debug(`[render-debug] ${label} render #${renderCount.current}`);
    }

    useEffect(() => {
        const nextMountCount = (mountCounts.get(label) || 0) + 1;
        mountCounts.set(label, nextMountCount);

        if (import.meta.env.DEV) {
            console.debug(`[render-debug] ${label} mount #${nextMountCount}`);
        }

        return () => {
            if (import.meta.env.DEV) {
                console.debug(`[render-debug] ${label} unmount`);
            }
        };
    }, [label]);
}
