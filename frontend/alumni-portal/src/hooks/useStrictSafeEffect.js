import { useEffect } from "react";

const recentEffectRuns = new Map();
const DEFAULT_WINDOW_MS = 1200;

export default function useStrictSafeEffect(key, effect, deps = [], options = {}) {
    const { label = key, windowMs = DEFAULT_WINDOW_MS } = options;

    useEffect(() => {
        const now = Date.now();
        const previousRun = recentEffectRuns.get(key) || 0;

        if (now - previousRun < windowMs) {
            if (import.meta.env.DEV) {
                console.debug(`[strict-safe-effect] skipped duplicate init for ${label}`);
            }
            return undefined;
        }

        recentEffectRuns.set(key, now);

        if (import.meta.env.DEV) {
            console.debug(`[strict-safe-effect] running init for ${label}`);
        }

        return effect();
        // deps are supplied explicitly by each caller
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps);
}
