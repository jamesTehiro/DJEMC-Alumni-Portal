import { useCallback, useEffect, useRef } from "react";
import { useUndoDelete } from "../hooks/useUndoDelete";
import "./UndoToast.css";

/**
 * Global Undo Toast component.
 *
 * Displays pending delete notifications with Undo button and countdown.
 * Must be rendered inside an UndoDeleteProvider.
 *
 * Features:
 * - Floating card, bottom center
 * - Rounded corners, soft shadow
 * - Slide-up + fade-in animation
 * - Countdown timer (5..4..3..2..1)
 * - Undo button with keyboard support (Enter/Space)
 * - Escape key dismisses (cancels the pending delete)
 * - ARIA live region for accessibility
 * - Dark mode compatible via CSS variables
 * - Supports multiple simultaneous pending deletes
 */
export default function UndoToast() {
    const { pendingDeletes, undoDelete } = useUndoDelete();
    const toastRef = useRef(null);

    // Keyboard handler: Escape dismisses last toast
    const handleKeyDown = useCallback(
        (e) => {
            if (e.key === "Escape" && pendingDeletes.length > 0) {
                const last = pendingDeletes[pendingDeletes.length - 1];
                undoDelete(last.id);
            }
        },
        [pendingDeletes, undoDelete]
    );

    useEffect(() => {
        if (pendingDeletes.length > 0) {
            document.addEventListener("keydown", handleKeyDown);
            return () => document.removeEventListener("keydown", handleKeyDown);
        }
    }, [pendingDeletes.length, handleKeyDown]);

    if (pendingDeletes.length === 0) return null;

    return (
        <div
            className="undo-toast-container"
            role="status"
            aria-live="polite"
            aria-relevant="additions removals"
            ref={toastRef}
        >
            {pendingDeletes.map((pd) => (
                <div key={pd.id} className="undo-toast-card" role="alert">
                    <div className="undo-toast-content">
                        <div className="undo-toast-icon">🗑️</div>
                        <div className="undo-toast-text">
                            <span className="undo-toast-title">{pd.itemName}</span>
                            <span className="undo-toast-message">{pd.message}</span>
                        </div>
                    </div>
                    <div className="undo-toast-actions">
                        <button
                            className="undo-toast-btn"
                            onClick={() => undoDelete(pd.id)}
                            aria-label={`Undo deletion of ${pd.itemName}`}
                        >
                            Undo
                        </button>
                        <span className="undo-toast-countdown" aria-hidden="true">
                            {pd.countdown}s
                        </span>
                    </div>
                </div>
            ))}
        </div>
    );
}