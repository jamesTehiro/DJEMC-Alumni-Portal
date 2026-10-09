import React from "react";
import { formatMessageTimestamp } from "../utils/messaging";

export default function ConversationListItem({
    conversation,
    title,
    avatarUrl,
    avatarFallback,
    active = false,
    onSelect
}) {
    return (
        <button
            type="button"
            className={`conversation-item ${active ? "active" : ""}`}
            onClick={onSelect}
        >
            <div className="conversation-avatar">
                {avatarUrl ? (
                    <img src={avatarUrl} alt={title} className="conversation-avatar-img" />
                ) : (
                    <span>{avatarFallback}</span>
                )}
            </div>
            <div className="conversation-copy">
                <div className="conversation-top">
                    <strong>{title}</strong>
                    <span>{formatMessageTimestamp(conversation.last_message_at)}</span>
                </div>
                <div className="conversation-preview">
                    {conversation.last_message_preview || "No messages yet."}
                </div>
            </div>
            {conversation.unread_count > 0 && (
                <span className="conversation-badge">{conversation.unread_count}</span>
            )}
        </button>
    );
}
