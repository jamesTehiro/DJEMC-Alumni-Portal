// Retain the identity after a failed response so a retry can return a message
// that already committed. A successful send starts a new identity.
export function beginMessageRequest(ref, conversation, text, attachment) {
    const previous = ref.current;
    if (previous?.inFlight) return null;
    const same = previous && previous.conversation === conversation && previous.text === text && previous.attachment === attachment;
    const id = same ? previous.id : globalThis.crypto.randomUUID();
    return (ref.current = { id, conversation, text, attachment, inFlight: true });
}

export function finishMessageRequest(ref, id, success) {
    if (ref.current?.id !== id) return;
    if (success) ref.current = null;
    else ref.current.inFlight = false;
}
