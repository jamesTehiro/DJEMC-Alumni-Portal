import { useContext, useCallback } from "react";
import { UndoDeleteContext } from "../context/UndoDeleteContext";

/**
 * useUndoDelete
 *
 * Hook that provides access to the Undo Delete system.
 *
 * @returns {Object} { scheduleDelete, undoDelete, cancelAllPending, pendingDeletes }
 *
 * Usage:
 *   const { scheduleDelete } = useUndoDelete();
 *
 *   const handleDelete = (item) => {
 *     const itemId = item.id;
 *     setItems((prev) => prev.filter((i) => i.id !== itemId));
 *     scheduleDelete({
 *       item,
 *       deleteAction: () => api.delete(`/endpoint/${itemId}`, true),
 *       restoreAction: () => setItems((prev) => [...prev, item].sort((a, b) => b.createdAt - a.createdAt)),
 *       message: "The item was deleted.",
 *       itemName: item.title || "Item",
 *     });
 *   };
 */
export function useUndoDelete() {
    const context = useContext(UndoDeleteContext);
    if (!context) {
        throw new Error("useUndoDelete must be used within an UndoDeleteProvider");
    }
    return context;
}

/**
 * Helper to create a sort function by a date field (default: createdAt).
 * For restoring items into a sorted list.
 */
export function sortByDate(field = "createdAt", order = "DESC") {
    const multiplier = order === "DESC" ? -1 : 1;
    return (a, b) => {
        const dateA = new Date(a[field] || 0).getTime();
        const dateB = new Date(b[field] || 0).getTime();
        return (dateA - dateB) * multiplier;
    };
}