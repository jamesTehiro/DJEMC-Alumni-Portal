import useChatViewport from "../hooks/useChatViewport";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Form, Spinner, Modal } from "react-bootstrap";
import { FiPaperclip, FiSend, FiSearch, FiMessageSquare, FiArrowLeft } from "react-icons/fi";
import { api, API_BASE_URL } from "../services/api";
import useStrictSafeEffect from "../hooks/useStrictSafeEffect";
import useAdaptivePoll from "../hooks/useAdaptivePoll";
import { mergeUniqueById } from "../utils/list";
import { formatMessageTimestamp, getConversationDisplayName } from "../utils/messaging";
import ConversationListItem from "../components/ConversationListItem";
import MessageOptionsMenu from "../components/MessageOptionsMenu";
import MessageAttachment from "../components/MessageAttachment";
import AttachmentSelectionPreview from "../components/AttachmentSelectionPreview";
import { ALLOWED_ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_MB, isImageAttachment } from "../utils/messageAttachments";
import "./MessagesPage.css";


const avatarLetter = (name = "U") => name[0]?.toUpperCase() || "U";

const mapUnified = (c) => ({
    id: `m:${c.id}`,
    source: "messages",
    rawId: c.id,
    name: c.name,
    type: c.type,
    last_message_preview: c.last_message_preview,
    last_message_at: c.last_message_at,
    unread_count: c.unread_count || 0,
    participant_avatar_url: c.participant_avatar_url || null,
    other_participant: c.other_participant || null,
    participants: Array.isArray(c.participants) ? c.participants : []
});

const mapLegacy = (c) => {
    const key = c.employerId ? `e:${c.employerId}` : `e:legacy:${c.id || Math.random()}`;
    return {
        id: key,
        source: "legacy",
        rawId: c.id || null,
        employerId: c.employerId || (c.employer && c.employer.id) || null,
        name: c.admin?.name || "Employer Admin",
        type: "legacy",
        participants: [c.admin, c.employer].filter(Boolean),
        last_message_preview: c.last_message_text || null,
        last_message_at: c.last_message_at || null,
        unread_count: c.unread_count || 0,
        participant_avatar_url: c.participant_avatar_url || null,
        legacy: c
    };
};

export default function EmployerMessagesPage() {
    useChatViewport();
    const [viewerProfile, setViewerProfile] = useState(null);
    const [conversations, setConversations] = useState([]);
    const [activeConversationId, setActiveConversationId] = useState(null);
    const [messages, setMessages] = useState([]);
    const [openMessageMenuId, setOpenMessageMenuId] = useState(null);
    const [draft, setDraft] = useState("");
    const [attachment, setAttachment] = useState(null);
    const [loadingConversations, setLoadingConversations] = useState(true);
    const [loadingMessages, setLoadingMessages] = useState(false);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState("");
    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState([]);
    const [searching, setSearching] = useState(false);
    const [imagePreview, setImagePreview] = useState(null);
    const [mobileView, setMobileView] = useState("list");
    const fileInputRef = useRef(null);
    const chatStreamRef = useRef(null);
    const searchTimeoutRef = useRef(null);
    const activeConversationRef = useRef(null);
    const messageRequestRef = useRef(0);
    const currentUserRef = useRef(null);

    const currentUser = useMemo(() => {
        try {
            return JSON.parse(localStorage.getItem("user") || "null");
        } catch {
            return null;
        }
    }, []);

    useEffect(() => { currentUserRef.current = currentUser; }, [currentUser]);

    const loadViewerProfile = useCallback(async () => {
        try {
            const data = await api.get("/profile", true);
            setViewerProfile(data);
        } catch (err) {
            setError(err.message);
        }
    }, []);

    const searchUsers = useCallback(async (query) => {
        if (!query || query.length < 2) {
            setSearchResults([]);
            return;
        }
        setSearching(true);
        try {
            const data = await api.get(`/messages/search-users?q=${encodeURIComponent(query)}`, true);
            setSearchResults(Array.isArray(data) ? data : []);
        } catch {
            setSearchResults([]);
        } finally {
            setSearching(false);
        }
    }, []);

    const handleSearchChange = (e) => {
        const value = e.target.value;
        setSearchQuery(value);
        if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
        searchTimeoutRef.current = setTimeout(() => searchUsers(value), 300);
    };

    const startDirectConversation = async (targetUserId) => {
        try {
            const conversation = await api.post("/messages/direct", { targetUserId }, true);
            if (conversation?.id) {
                setSearchQuery("");
                setSearchResults([]);
                await loadConversations(true);
                setOpenMessageMenuId(null);
                setActiveConversationId(`m:${conversation.id}`);
            }
        } catch (err) {
            setError(err.message);
        }
    };

    const loadConversations = useCallback(async (isInitial = false) => {
        if (isInitial) setLoadingConversations(true);
        try {
            const unifiedPromise = api.get("/messages/conversations", true);
            const legacyPromise = api.get("/admin-employer/conversations", true);
            const [unifiedResult, legacyResult] = await Promise.allSettled([unifiedPromise, legacyPromise]);
            if (unifiedResult.status === "rejected" && legacyResult.status === "rejected") throw unifiedResult.reason;
            const unified = unifiedResult.status === "fulfilled" ? unifiedResult.value : [];
            const legacy = legacyResult.status === "fulfilled" ? legacyResult.value : [];

            const unifiedList = Array.isArray(unified) ? unified.filter((c) => c.type !== "forum").map(mapUnified) : [];
            const legacyList = Array.isArray(legacy) ? legacy.map(mapLegacy) : [];

            const merged = [...unifiedList, ...legacyList].sort((a, b) => {
                const ta = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
                const tb = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
                return tb - ta;
            });

            setConversations((prev) => {
                if (prev.length === merged.length && prev.every((item, i) => item.id === merged[i].id && item.unread_count === merged[i].unread_count && item.last_message_at === merged[i].last_message_at && item.last_message_preview === merged[i].last_message_preview)) {
                    return prev;
                }
                return merged;
            });

            setActiveConversationId((prev) => {
                if (prev && merged.some((item) => item.id === prev)) return prev;
                return merged[0]?.id || null;
            });
        } catch (err) {
            setError(err.message);
        } finally {
            if (isInitial) setLoadingConversations(false);
        }
    }, []);

    const loadMessages = useCallback(async (conversationId) => {
        if (!conversationId) return;
        const requestId = ++messageRequestRef.current;
        setLoadingMessages(true);
        setMessages([]);
        const convo = conversations.find((c) => c.id === conversationId);
        if (!convo) { setLoadingMessages(false); return; }
        try {
            if (!convo) return;
            if (convo?.source === "legacy") {
                const employerId = convo.employerId;
                const data = await api.get(`/admin-employer/messages/${employerId}`, true);
                const mapped = Array.isArray(data?.messages) ? data.messages.map((m) => ({
                    id: m.id,
                    sender_id: m.senderId,
                    message_text: m.message,
                    file_url: m.attachment || null,
                    file_name: m.file_name || m.attachmentName || null,
                    file_mime: m.file_mime || m.mimeType || null,
                    file_size: m.file_size ?? null,
                    created_at: m.createdAt,
                    sender: m.senderType === "admin" ? { id: m.senderId, name: data.conversation?.admin?.name, role: "admin", admin_avatar_url: data.conversation?.admin?.admin_avatar_url } : { id: m.senderId, name: data.conversation?.employer?.name, role: "employer", avatar_url: data.conversation?.employer?.logo_url }
                })) : [];
                if (requestId === messageRequestRef.current && activeConversationRef.current === conversationId) setMessages(mapped);
            } else {
                const rawId = convo?.rawId;
                const data = await api.get(`/messages/${rawId}`, true);
                if (requestId === messageRequestRef.current && activeConversationRef.current === conversationId) setMessages(Array.isArray(data?.messages) ? data.messages : []);
            }
        } catch (err) {
            if (requestId === messageRequestRef.current) setError(err.message);
        } finally {
            if (requestId === messageRequestRef.current) setLoadingMessages(false);
        }
    }, [conversations]);

    useStrictSafeEffect(
        "EmployerMessagesPage:init",
        () => {
            loadViewerProfile();
            loadConversations(true);
            return undefined;
        },
        [loadViewerProfile, loadConversations],
        { label: "EmployerMessagesPage init" }
    );

    useEffect(() => {
        activeConversationRef.current = activeConversationId;
        if (!activeConversationId) {
            ++messageRequestRef.current;
            setMessages([]);
            setLoadingMessages(false);
            return;
        }
        loadMessages(activeConversationId);
    }, [activeConversationId, loadMessages]);

    useAdaptivePoll(async () => { await loadConversations(); }, { enabled: true, minDelay: 60000, hiddenDelay: 120000, maxDelay: 300000, singletonKey: "messages:conversations", deps: [loadConversations] });

    const sendMessage = async () => {
        const convo = conversations.find((c) => c.id === activeConversationId);
        if (!convo) return;
        if (!draft.trim() && !attachment) return;
        if (attachment && attachment.size > MAX_ATTACHMENT_BYTES) {
            setError(`This file is too large. Maximum attachment size is ${MAX_ATTACHMENT_MB} MB.`);
            return;
        }
        setSending(true);
        setError("");
        try {
            if (convo.source === "legacy") {
                const form = new FormData();
                form.append("employerId", convo.employerId);
                if (draft.trim()) form.append("message", draft.trim());
                if (attachment) form.append("attachment", attachment);
                const result = await api.post(`/admin-employer/messages`, form, true, { isMultipart: true });
                const sentConversationId = activeConversationId;
                const m = result.message;
                if (m && activeConversationRef.current === sentConversationId) setMessages((prev) => mergeUniqueById(prev, [{ id: m.id, sender_id: m.senderId, message_text: m.message, file_url: m.attachment, file_name: m.file_name || attachment?.name || null, file_mime: m.file_mime || attachment?.type || null, file_size: m.file_size ?? attachment?.size ?? null, created_at: m.createdAt, sender: { id: m.senderId, name: currentUserRef.current?.name, role: currentUserRef.current?.role, avatar_url: currentUserRef.current?.avatar_url, admin_avatar_url: currentUserRef.current?.admin_avatar_url } }]));
                await loadConversations();
            } else {
                const form = new FormData();
                if (draft.trim()) form.append("message_text", draft.trim());
                if (attachment) form.append("attachment", attachment);
                const rawId = convo.rawId;
                const saved = await api.post(`/messages/${rawId}`, form, true, { isMultipart: true });
                if (activeConversationRef.current === activeConversationId) setMessages((prev) => mergeUniqueById(prev, [saved]));
                await loadConversations();
            }
            setDraft("");
            setAttachment(null);
            if (fileInputRef.current) fileInputRef.current.value = "";
        } catch (err) {
            setError(err.message);
        } finally {
            setSending(false);
        }
    };

    const deleteMessage = async (message) => {
        const conversation = conversations.find((item) => item.id === activeConversationId);
        if (!conversation || !message?.id) return;
        if (!window.confirm("Delete this message?")) return;

        try {
            if (conversation.source === "legacy") {
                await api.delete(`/admin-employer/messages/${conversation.employerId}/${message.id}`, true);
            } else {
                await api.delete(`/messages/${conversation.rawId}/messages/${message.id}`, true);
            }

            setMessages((prev) => prev.filter((item) => item.id !== message.id));
            await loadConversations();
        } catch (err) {
            setError(err.message);
        }
    };

    const openAttachment = async (message, disposition = "inline") => {
        if (!message?.file_url) return;
        try {
            const token = localStorage.getItem("token");
            const response = await fetch(`${API_BASE_URL.replace(/\/api$/, "")}${message.file_url}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
            if (!response.ok) throw new Error("Unable to open attachment.");
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            if (disposition === "download") {
                const link = document.createElement("a"); link.href = url; link.download = message.file_name || "attachment"; link.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
            } else if ((message.file_mime || "").startsWith("image/")) {
                setImagePreview({ url, name: message.file_name || "Image" });
            } else {
                window.open(url, "_blank", "noopener,noreferrer");
                setTimeout(() => URL.revokeObjectURL(url), 60000);
            }
        } catch (err) {
            setError(err.message);
        }
    };

    const renderAvatar = (person) => {
        if (!person) return <span>{avatarLetter("U")}</span>;
        if (person.avatar_url || person.admin_avatar_url || person.logo_url) {
            const src = person.avatar_url || person.admin_avatar_url || person.logo_url;
            return <img src={src} alt={person.name || "User"} />;
        }
        return <span>{avatarLetter(person.name)}</span>;
    };

    return (
        <div className={`messages-page employer-messages-page ${mobileView === "chat" ? "mobile-view-chat" : "mobile-view-list"}`}>
            <div className="messages-shell">
                <aside className="conversation-sidebar">
                    <div className="sidebar-search">
                        <FiSearch className="sidebar-search-icon" />
                        <Form.Control type="text" placeholder="Search users to message..." value={searchQuery} onChange={handleSearchChange} className="sidebar-search-input" />
                        {searching && <Spinner animation="border" size="sm" className="sidebar-search-spinner" />}
                    </div>

                    {searchResults.length > 0 && (
                        <div className="sidebar-search-results">
                            <div className="sidebar-search-header">Search Results</div>
                            {searchResults.map((user) => (
                                <button key={user.id} type="button" className="conversation-item search-result-item" onClick={() => startDirectConversation(user.id)}>
                                    <div className="conversation-avatar">{user.avatar_url ? <img src={user.avatar_url} alt={user.name} /> : <span>{avatarLetter(user.name)}</span>}</div>
                                    <div className="conversation-copy">
                                        <div className="conversation-top"><strong>{user.name}</strong><span className="user-role-tag">{user.role}</span></div>
                                        <div className="conversation-preview">{user.organization_name || user.email}</div>
                                    </div>
                                    <FiMessageSquare className="start-chat-icon" />
                                </button>
                            ))}
                        </div>
                    )}

                    <div className="sidebar-heading">Conversations</div>
                    <div className="conversation-list">
                        {loadingConversations && <div className="sidebar-state"><Spinner animation="border" size="sm" /> Loading conversations...</div>}
                        {!loadingConversations && conversations.length === 0 && <div className="sidebar-state">No conversations.</div>}
                        {!loadingConversations && conversations.map((conversation) => {
                            const title = getConversationDisplayName(conversation, viewerProfile || currentUser);
                            return (
                                <ConversationListItem
                                    key={conversation.id}
                                    conversation={conversation}
                                    title={title}
                                    avatarUrl={conversation.participant_avatar_url}
                                    avatarFallback={conversation.type === "batch" ? "B" : avatarLetter(title)}
                                    active={conversation.id === activeConversationId}
                                    onSelect={() => { setOpenMessageMenuId(null); setMessages([]); setActiveConversationId(conversation.id); setMobileView("chat"); }}
                                />
                            );
                        })}
                    </div>
                </aside>

                <section className="chat-panel">
                    <div className="chat-header"><button type="button" className="mobile-back-btn employer-mobile-back" onClick={() => setMobileView("list")} aria-label="Back to conversations"><FiArrowLeft /></button><div><h3>{getConversationDisplayName(conversations.find((c) => c.id === activeConversationId), viewerProfile || currentUser) || "Select a conversation"}</h3></div></div>

                    <div className="chat-stream" ref={chatStreamRef}>
                        {loadingMessages && <div className="chat-state"><Spinner animation="border" size="sm" /> Loading messages...</div>}
                        {!loadingMessages && messages.length === 0 && <div className="chat-state">{activeConversationId ? "No messages yet. Start the conversation." : "Search for a user to start a conversation."}</div>}

                        {!loadingMessages && messages.map((message) => {
                            const isOwnMessage = Number(message.sender_id) === Number(currentUser?.id);
                            return (
                                <div key={message.id || Math.random()} className={`message-row ${isOwnMessage ? "outgoing" : "incoming"}`}>
                                    {!isOwnMessage && (
                                        <button type="button" className="message-avatar" onClick={() => { }}>{renderAvatar(message.sender)}</button>
                                    )}

                                    <div className="message-content">
                                        <div className="message-meta">
                                            <div className="message-meta-left">
                                                <button type="button" className="message-author">{message.sender?.name || (message.sender?.role === "employer" ? "Employer" : "User")}</button>
                                                <span>{formatMessageTimestamp(message.created_at || message.createdAt)}</span>
                                            </div>
                                        </div>

                                        <div className={`message-bubble-wrapper${isImageAttachment(message) ? " has-image" : ""}`}>
                                            {message.message_text && <div className="message-bubble">{message.message_text}</div>}
                                            {isOwnMessage && (
                                                <MessageOptionsMenu
                                                    open={openMessageMenuId === message.id}
                                                    onToggle={() => setOpenMessageMenuId((current) => current === message.id ? null : message.id)}
                                                    onClose={() => setOpenMessageMenuId(null)}
                                                    onDelete={() => deleteMessage(message)}
                                                />
                                            )}
                                            {message.file_url && isImageAttachment(message) && <MessageAttachment message={message} openAttachment={openAttachment} />}
                                        </div>

                                        {message.file_url && !isImageAttachment(message) && <MessageAttachment message={message} openAttachment={openAttachment} />}
                                    </div>

                                    {isOwnMessage && (
                                        <button type="button" className="message-avatar" onClick={() => { }}>{renderAvatar(message.sender)}</button>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    {activeConversationId && <div className="chat-composer">
                        <AttachmentSelectionPreview file={attachment} onRemove={() => { setAttachment(null); if (fileInputRef.current) fileInputRef.current.value = ""; }} />
                        <div className="composer-row">
                            <button type="button" className="attach-btn" aria-label="Attach a file" onClick={() => fileInputRef.current?.click()} title="Attach a file"><FiPaperclip /></button>
                            <input ref={fileInputRef} type="file" hidden accept={ALLOWED_ATTACHMENT_TYPES} onChange={(e) => { const selected = e.target.files?.[0] || null; if (selected && selected.size > MAX_ATTACHMENT_BYTES) { setError(`This file is too large. Maximum attachment size is ${MAX_ATTACHMENT_MB} MB.`); e.target.value = ""; return; } setError(""); setAttachment(selected); }} />
                            <Form.Control placeholder="Write a message..." value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }} />
                            <Button type="button" className="send-btn" onClick={sendMessage} disabled={sending}>{sending ? <Spinner animation="border" size="sm" /> : <FiSend />}</Button>
                        </div>
                    </div>}
                </section>
            </div>

            {error && <p className="messages-error" role="alert">{error}</p>}
            <Modal show={!!imagePreview} onHide={() => { if (imagePreview?.url) URL.revokeObjectURL(imagePreview.url); setImagePreview(null); }} centered size="lg"><Modal.Header closeButton><Modal.Title>{imagePreview?.name}</Modal.Title></Modal.Header><Modal.Body className="message-image-lightbox"><img src={imagePreview?.url} alt={imagePreview?.name || "Attachment preview"} /></Modal.Body></Modal>
        </div>
    );
}
