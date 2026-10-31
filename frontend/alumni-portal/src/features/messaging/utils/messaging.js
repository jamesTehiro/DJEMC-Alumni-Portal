const cleanName = (value) => (typeof value === "string" ? value.trim() : "");

const flattenParticipant = (participant) => {
    let current = participant;
    while (current && (current.User || current.user || current.participant)) {
        current = current.User || current.user || current.participant;
    }
    return current || null;
};

const getDirectContactName = (conversation, currentUser) => {
    const explicitContact = cleanName(conversation.other_participant?.name);
    if (explicitContact) return explicitContact;

    const participants = Array.isArray(conversation.participants)
        ? conversation.participants.map(flattenParticipant).filter(Boolean)
        : [];
    const viewerId = currentUser?.id == null ? null : String(currentUser.id);

    if (viewerId) {
        const other = participants.find((participant) => {
            const id = participant.id ?? participant.user_id ?? participant.userId;
            return id != null && String(id) !== viewerId;
        });
        const otherName = cleanName(other?.name ?? other?.display_name);
        if (otherName) return otherName;
    }

    // Older direct conversations only include a generated combined title. Use
    // the authenticated user's identity to remove their own name safely.
    const combinedTitle = cleanName(conversation.name).replace(/^Direct:\s*/i, "");
    const names = combinedTitle.split(/\s*&\s*/).map(cleanName).filter(Boolean);
    if (names.length > 1) {
        const ownNames = [currentUser?.name, currentUser?.email]
            .map((name) => cleanName(name).toLocaleLowerCase())
            .filter(Boolean);
        const viewerNameIndex = names.findIndex((name) => ownNames.includes(name.toLocaleLowerCase()));
        if (viewerNameIndex >= 0) {
            const contact = names.find((_, index) => index !== viewerNameIndex);
            if (contact) return contact;
        }
    }

    return "Conversation";
};

export const getConversationDisplayName = (conversation, currentUser) => {
    if (!conversation) return "";
    if (conversation.type === "direct" || conversation.type === "legacy") {
        return getDirectContactName(conversation, currentUser);
    }
    return cleanName(conversation.name) || "Conversation";
};

export const formatMessageTimestamp = (value) => {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString();
};
