import { useEffect, useRef } from "react";

const DEFAULT_MIN_DELAY = 4000;
const DEFAULT_MAX_DELAY = 30000;
const DEFAULT_HIDDEN_DELAY = 12000;
const DEFAULT_BACKOFF_FACTOR = 2;

// Global singleton registry for named polling tasks
const SINGLETONS = new Map();

export default function useAdaptivePoll(task, options = {}) {
    const {
        enabled = true,
        minDelay = DEFAULT_MIN_DELAY,
        maxDelay = DEFAULT_MAX_DELAY,
        hiddenDelay = DEFAULT_HIDDEN_DELAY,
        backoffFactor = DEFAULT_BACKOFF_FACTOR,
        deps = [],
        // Optional: when provided, polling for the same key will be shared across hook instances
        singletonKey = null
    } = options;

    const taskRef = useRef(task);
    const timerRef = useRef(null);
    const attemptRef = useRef(0);

    taskRef.current = task;

    useEffect(() => {
        if (!enabled) {
            // If not enabled, ensure local timer is cleared and singleton subscriber is removed
            if (!singletonKey) {
                if (timerRef.current) {
                    clearTimeout(timerRef.current);
                    timerRef.current = null;
                }
                attemptRef.current = 0;
            } else {
                const entry = SINGLETONS.get(singletonKey);
                if (entry) {
                    entry.subscribers -= 1;
                    if (entry.subscribers <= 0) {
                        if (entry.timer) clearTimeout(entry.timer);
                        SINGLETONS.delete(singletonKey);
                    }
                }
            }
            return undefined;
        }

        // If a singletonKey is provided, register with the singleton manager
        if (singletonKey) {
            let entry = SINGLETONS.get(singletonKey);
            if (!entry) {
                entry = {
                    taskRef: { current: taskRef.current },
                    timer: null,
                    attempt: 0,
                    subscribers: 0,
                    config: { minDelay, maxDelay, hiddenDelay, backoffFactor }
                };
                SINGLETONS.set(singletonKey, entry);
            }

            entry.subscribers += 1;
            // update the stored task to the latest subscriber's task (they should be functionally identical)
            entry.taskRef.current = taskRef.current;
            // update config if changed (keep the most conservative values)
            entry.config.minDelay = Math.max(entry.config.minDelay || 0, minDelay);
            entry.config.maxDelay = Math.max(entry.config.maxDelay || 0, maxDelay);
            entry.config.hiddenDelay = Math.max(entry.config.hiddenDelay || 0, hiddenDelay);
            entry.config.backoffFactor = Math.max(entry.config.backoffFactor || 0, backoffFactor);

            let cancelled = false;

            const scheduleNext = (delay) => {
                if (cancelled) return;
                if (entry.timer) clearTimeout(entry.timer);
                entry.timer = setTimeout(run, delay);
            };

            const run = async () => {
                if (cancelled) return;
                try {
                    await entry.taskRef.current?.();
                    entry.attempt = 0;
                    scheduleNext(document.hidden ? entry.config.hiddenDelay : entry.config.minDelay);
                } catch (err) {
                    entry.attempt = (entry.attempt || 0) + 1;
                    const nextDelay = Math.min(
                        entry.config.minDelay * entry.config.backoffFactor ** entry.attempt,
                        entry.config.maxDelay
                    );
                    scheduleNext(nextDelay);
                }
            };

            // Start the singleton timer if not already running
            if (!entry.timer) {
                scheduleNext(document.hidden ? entry.config.hiddenDelay : entry.config.minDelay);
            }

            return () => {
                cancelled = true;
                entry.subscribers -= 1;
                if (entry.subscribers <= 0) {
                    if (entry.timer) clearTimeout(entry.timer);
                    SINGLETONS.delete(singletonKey);
                }
            };
        }

        // Default (non-singleton) behavior — local timer per hook instance
        let cancelled = false;

        const scheduleNext = (delay) => {
            if (cancelled) return;
            if (timerRef.current) clearTimeout(timerRef.current);
            timerRef.current = setTimeout(run, delay);
        };

        const run = async () => {
            if (cancelled) return;

            try {
                await taskRef.current?.();
                attemptRef.current = 0;
                scheduleNext(document.hidden ? hiddenDelay : minDelay);
            } catch {
                attemptRef.current += 1;
                const nextDelay = Math.min(
                    minDelay * backoffFactor ** attemptRef.current,
                    maxDelay
                );
                scheduleNext(nextDelay);
            }
        };

        scheduleNext(document.hidden ? hiddenDelay : minDelay);

        return () => {
            cancelled = true;
            if (timerRef.current) {
                clearTimeout(timerRef.current);
                timerRef.current = null;
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled, minDelay, maxDelay, hiddenDelay, backoffFactor, singletonKey, ...deps]);
}
