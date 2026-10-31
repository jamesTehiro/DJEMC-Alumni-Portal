import { createContext, useCallback, useRef, useState, useEffect } from "react";

export const UndoDeleteContext = createContext(null);

const UNDO_TIMEOUT = 5000; // 5 seconds

/**
 * Generates a unique ID for each pending delete operation.
 */
let nextId = 1;
const generateId = () => `undo-${Date.now()}-${nextId++}`;

/**
 * UndoDeleteProvider
 *
 * Manages a queue of pending delete operations.
 * Each pending delete has:
 *  - id: unique identifier
 *  - item: the item data (for UI display / restore)
 *  - message: display message for the toast
 *  - deleteAction: async function that performs the actual backend DELETE
 *  - restoreAction: async function that restores the item in local state
 *  - expiresAt: timestamp when the delete should be executed
 *  - countdown: remaining seconds
 */
export function UndoDeleteProvider({ children }) {
    const [pendingDeletes, setPendingDeletes] = useState([]);
    const timersRef = useRef({});
    const countdownIntervalsRef = useRef({});

    // Clean up all timers on unmount
    useEffect(() => {
        return () => {
            Object.values(timersRef.current).forEach(clearTimeout);
            Object.values(countdownIntervalsRef.current).forEach(clearInterval);
        };
    }, []);

    const clearTimers = useCallback((id) => {
        if (timersRef.current[id]) {
            clearTimeout(timersRef.current[id]);
            delete timersRef.current[id];
        }
        if (countdownIntervalsRef.current[id]) {
            clearInterval(countdownIntervalsRef.current[id]);
            delete countdownIntervalsRef.current[id];
        }
    }, []);

    /**
     * Schedule a delete operation.
     *
     * @param {Object} params
     * @param {*} params.item - The item being deleted (for restore)
     * @param {Function} params.deleteAction - Async function that calls the backend DELETE endpoint
     * @param {Function} params.restoreAction - Function to restore the item in local state
     * @param {string} params.message - Toast message (e.g. "The job was deleted.")
     * @param {string} [params.itemName] - Optional item name for the toast title
     */
    const scheduleDelete = useCallback(({ item, deleteAction, restoreAction, message, itemName }) => {
        const id = generateId();
        const expiresAt = Date.now() + UNDO_TIMEOUT;

        // Add to pending deletes
        setPendingDeletes((prev) => [
            ...prev,
            {
                id,
                item,
                message: message || "Item was deleted.",
                itemName: itemName || "Item",
                deleteAction,
                restoreAction,
                expiresAt,
                countdown: 5,
            },
        ]);

        // Start countdown interval
        countdownIntervalsRef.current[id] = setInterval(() => {
            setPendingDeletes((prev) =>
                prev.map((pd) => {
                    if (pd.id !== id) return pd;
                    const remaining = Math.max(0, Math.ceil((pd.expiresAt - Date.now()) / 1000));
                    return { ...pd, countdown: remaining };
                })
            );
        }, 200);

        // Schedule the actual delete
        timersRef.current[id] = setTimeout(async () => {
            clearTimers(id);
            try {
                await deleteAction();
            } catch (err) {
                console.error(`[UndoDelete] Delete failed for ${id}:`, err);
                // If delete fails, restore the item
                setPendingDeletes((prev) => prev.filter((pd) => pd.id !== id));
                if (restoreAction) {
                    restoreAction();
                }
                return;
            }
            // Remove from pending
            setPendingDeletes((prev) => prev.filter((pd) => pd.id !== id));
        }, UNDO_TIMEOUT);

        return id;
    }, [clearTimers]);

    /**
     * Undo a pending delete.
     */
    const undoDelete = useCallback(
        (id) => {
            clearTimers(id);
            setPendingDeletes((prev) => {
                const target = prev.find((pd) => pd.id === id);
                if (target && target.restoreAction) {
                    // Use setTimeout to avoid state update during render
                    setTimeout(() => target.restoreAction(), 0);
                }
                return prev.filter((pd) => pd.id !== id);
            });
        },
        [clearTimers]
    );

    /**
     * Cancel all pending deletes (e.g., on logout, route change).
     */
    const cancelAllPending = useCallback(() => {
        Object.keys(timersRef.current).forEach((id) => clearTimers(id));
        setPendingDeletes([]);
    }, [clearTimers]);

    return (
        <UndoDeleteContext.Provider
            value={{
                pendingDeletes,
                scheduleDelete,
                undoDelete,
                cancelAllPending,
            }}
        >
            {children}
        </UndoDeleteContext.Provider>
    );
}