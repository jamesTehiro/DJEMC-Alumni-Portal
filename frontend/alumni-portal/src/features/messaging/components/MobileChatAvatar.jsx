import { useState } from "react";

// Presentation only: each portal supplies its own authorized participant data.
export default function MobileChatAvatar({ src, name = "Conversation", fallback }) {
    const [failedSrc, setFailedSrc] = useState(null);
    return (
        <div className="chat-contact-avatar mobile-chat-avatar" aria-hidden="true">
            {src && failedSrc !== src
                ? <img src={src} alt="" onError={() => setFailedSrc(src)} />
                : <span>{fallback || name[0]?.toUpperCase() || "U"}</span>}
        </div>
    );
}
