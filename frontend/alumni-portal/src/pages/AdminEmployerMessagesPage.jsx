import React, { useEffect, useMemo, useRef, useState } from "react";
import { Button, Form, Modal, Spinner } from "react-bootstrap";
import { useNavigate } from "react-router-dom";
import { FiPaperclip, FiSearch, FiSend } from "react-icons/fi";
import { api, fetchFile } from "../services/api";
import useRenderDebug from "../hooks/useRenderDebug";
import useStrictSafeEffect from "../hooks/useStrictSafeEffect";
import useAdaptivePoll from "../hooks/useAdaptivePoll";
import { mergeUniqueById, replaceUniqueById } from "../utils/list";
import AdminShell from "../components/AdminShell";
import MessageOptionsMenu from "../components/MessageOptionsMenu";
import AttachmentSelectionPreview from "../components/AttachmentSelectionPreview";
import { ALLOWED_ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_MB } from "../utils/messageAttachments";
import "./MessagesPage.css";
import "./AdminEmployerMessagesPage.css";

const getConversationSearchText = (conversation) => {
    const relatedPeople = [
        conversation.participant,
        conversation.user,
        conversation.employer,
        conversation.alumni,
        conversation.recipient
    ].filter(Boolean);
    const fields = [
        conversation.name,
        conversation.title,
        conversation.participant_name,
        conversation.participant_email,
        conversation.user_name,
        conversation.user_email,
        conversation.email,
        conversation.organization_name,
        conversation.company_name,
        conversation.course,
        conversation.batch,
        conversation.last_message_preview,
        conversation.last_message_text,
        ...relatedPeople.flatMap((person) => [
            person.name,
            person.full_name,
            person.email,
            person.organization_name,
            person.company_name,
            person.course,
            person.batch
        ])
    ];
    return fields.filter((value) => typeof value === "string").join(" ").toLocaleLowerCase();
};

const formatTimestamp = (value) => {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString();
};

export default function AdminEmployerMessagesPage() {
    useRenderDebug("AdminEmployerMessagesPage");
    const navigate = useNavigate();
    const [forumConversations, setForumConversations] = useState([]);

    const handleLogout = () => {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        navigate("/");
    };

    const [conversations, setConversations] = useState([]);
    const [activeThread, setActiveThread] = useState(null);
    const [messages, setMessages] = useState([]);
    const [openMessageMenuId, setOpenMessageMenuId] = useState(null);
    const [draft, setDraft] = useState("");
    const [attachment, setAttachment] = useState(null);
    const [loadingConversations, setLoadingConversations] = useState(true);
    const [loadingMessages, setLoadingMessages] = useState(false);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState("");
    const [profileLoading, setProfileLoading] = useState(false);
    const [selectedProfile, setSelectedProfile] = useState(null);
    const [showProfileModal, setShowProfileModal] = useState(false);
    const [conversationSearch, setConversationSearch] = useState("");
    const fileInputRef = useRef(null);
    const chatStreamRef = useRef(null);

    const currentUser = useMemo(() => {
        try {
            return JSON.parse(localStorage.getItem("user") || "null");
        } catch {
            return null;
        }
    }, []);

    const areThreadListsEqual = (prev, next, selector = (item) => item.threadKey) => {
        if (prev.length !== next.length) return false;
        return prev.every((item, index) => {
            const nextItem = next[index];
            return (
                selector(item) === selector(nextItem) &&
                item.last_message_at === nextItem.last_message_at &&
                (item.last_message_preview || item.last_message_text) === (nextItem.last_message_preview || nextItem.last_message_text) &&
                item.unread_count === nextItem.unread_count
            );
        });
    };

    const combinedThreads = useMemo(
        () => [
            ...forumConversations.map((conversation) => ({ ...conversation, threadType: "forum" })),
            ...conversations.map((conversation) => ({ ...conversation, threadType: "private" }))
        ],
        [forumConversations, conversations]
    );

    const filteredThreads = useMemo(() => {
        const query = conversationSearch.trim().toLocaleLowerCase();
        if (!query) return combinedThreads;
        return combinedThreads.filter((conversation) => getConversationSearchText(conversation).includes(query));
    }, [combinedThreads, conversationSearch]);

    const activeConversation = useMemo(
        () => combinedThreads.find((item) => item.threadKey === activeThread) || null,
        [combinedThreads, activeThread]
    );

    const loadForumConversations = async () => {
        try {
            const data = await api.get("/messages/conversations", true);
            const list = (Array.isArray(data) ? data : [])
                .filter((conversation) => conversation.type === "forum")
                .map((conversation) => ({
                    ...conversation,
                    threadKey: `forum-${conversation.id}`
                }));
            setForumConversations((prev) => {
                if (areThreadListsEqual(prev, list, (item) => item.threadKey)) {
                    return prev;
                }
                return list;
            });
        } catch (err) {
            setError(err.message);
        }
    };

    const loadConversations = async (isInitial = false) => {
        if (isInitial) {
            setLoadingConversations(true);
        }
        try {
            const data = await api.get("/admin-employer/conversations", true);
            const list = (Array.isArray(data) ? data : []).map((conversation) => ({
                ...conversation,
                threadKey: `private-${conversation.employerId}`
            }));
            setConversations((prev) => {
                if (areThreadListsEqual(prev, list, (item) => item.threadKey)) {
                    return prev;
                }
                return list;
            });
        } catch (err) {
            setError(err.message);
        } finally {
            if (isInitial) {
                setLoadingConversations(false);
            }
        }
    };

    const loadMessages = async (thread) => {
        if (!thread) return;
        setLoadingMessages(true);
        try {
            if (thread.threadType === "forum") {
                const data = await api.get(`/messages/${thread.id}?limit=30`, true);
                setMessages(
                    (Array.isArray(data?.messages) ? data.messages : []).map((message) => ({
                        ...message,
                        threadType: "forum"
                    }))
                );
            } else {
                const data = await api.get(`/admin-employer/messages/${thread.employerId}`, true);
                setMessages(
                    (Array.isArray(data?.messages) ? data.messages : []).map((message) => ({
                        ...message,
                        threadType: "private"
                    }))
                );
                if (data?.conversation) {
                    setConversations((prev) =>
                        prev.map((item) =>
                            item.employerId === thread.employerId
                                ? { ...item, ...data.conversation, threadKey: `private-${thread.employerId}` }
                                : item
                        )
                    );
                }
            }
        } catch (err) {
            setError(err.message);
            setMessages([]);
        } finally {
            setLoadingMessages(false);
        }
    };

    useEffect(() => {
        loadForumConversations();
        loadConversations(true);
    }, []);

    useEffect(() => {
        if (!activeConversation) return;
        loadMessages(activeConversation);
    }, [activeConversation?.threadKey]);

    useEffect(() => {
        if (combinedThreads.length === 0) return;
        if (!activeConversation || !combinedThreads.some((thread) => thread.threadKey === activeThread)) {
            setActiveThread(combinedThreads[0].threadKey);
        }
    }, [activeConversation, activeThread, combinedThreads]);

    useAdaptivePoll(
        async () => {
            await Promise.all([
                loadForumConversations(),
                loadConversations()
            ]);
        },
        {
            enabled: true,
            // poll less frequently for conversation lists
            minDelay: 60000,
            hiddenDelay: 120000,
            maxDelay: 300000,
            // share the same singleton for messages conversations
            singletonKey: "messages:conversations",
            deps: []
        }
    );

    useEffect(() => {
        chatStreamRef.current?.scrollTo({
            top: chatStreamRef.current.scrollHeight,
            behavior: "smooth"
        });
    }, [messages]);

    const openProfile = async (userId) => {
        if (!userId) return;
        setProfileLoading(true);
        setSelectedProfile(null);
        setShowProfileModal(true);
        try {
            const data = await api.get(`/profile/${userId}`, true);
            const cachedUser = (() => {
                try {
                    return JSON.parse(localStorage.getItem("user") || "null");
                } catch {
                    return null;
                }
            })();
            const merged =
                data?.role === "admin" && cachedUser?.id === data?.id
                    ? {
                        ...data,
                        admin_department: data.admin_department || cachedUser?.admin_department || "",
                        admin_avatar_url: data.admin_avatar_url || cachedUser?.admin_avatar_url || ""
                    }
                    : data;
            setSelectedProfile(merged);
        } catch (err) {
            setError(err.message);
        } finally {
            setProfileLoading(false);
        }
    };

    const getProfileAvatarUrl = (profile) =>
        profile?.admin_avatar_url || profile?.AlumniProfile?.avatar_url || profile?.EmployerProfile?.logo_url;

    const openAttachment = async (message, disposition = "inline") => {
        const fileUrl = message?.file_url || message?.attachment;
        if (!fileUrl) return;
        try {
            const blob = await fetchFile(fileUrl, true);
            const url = URL.createObjectURL(blob);
            if (disposition === "download") {
                const link = document.createElement("a");
                link.href = url;
                link.download = message.file_name || "attachment";
                link.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
            } else {
                window.open(url, "_blank", "noopener,noreferrer");
                setTimeout(() => URL.revokeObjectURL(url), 60000);
            }
        } catch (err) {
            setError(err.message);
        }
    };

    const sendMessage = async () => {
        if (!activeConversation || (!draft.trim() && !attachment)) return;
        setSending(true);
        setError("");
        try {
            if (activeConversation.threadType === "forum") {
                const formData = new FormData();
                if (draft.trim()) formData.append("message_text", draft.trim());
                if (attachment) formData.append("attachment", attachment);

                const saved = await api.post(`/messages/${activeConversation.id}`, formData, true);
                setMessages((prev) => mergeUniqueById(prev, [{ ...saved, threadType: "forum" }]));
                setForumConversations((prev) =>
                    prev.map((item) =>
                        item.id === activeConversation.id
                            ? {
                                ...item,
                                last_message_preview: saved.message_text || saved.file_name || item.last_message_preview,
                                last_message_at: saved.created_at || saved.createdAt || new Date().toISOString()
                            }
                            : item
                    )
                );
            } else {
                const formData = new FormData();
                formData.append("employerId", String(activeConversation.employerId));
                if (draft.trim()) formData.append("message", draft.trim());
                if (attachment) formData.append("attachment", attachment);

                const saved = await api.post("/admin-employer/messages", formData, true);
                setMessages((prev) => mergeUniqueById(prev, [{ ...saved.message, threadType: "private" }]));
                setConversations((prev) =>
                    prev.map((item) =>
                        item.employerId === activeConversation.employerId
                            ? {
                                ...item,
                                last_message_text: saved.message?.message || attachment?.name || item.last_message_text,
                                last_message_at: saved.message?.createdAt || new Date().toISOString()
                            }
                            : item
                    )
                );
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
        const confirmed = window.confirm("Delete this message?");
        if (!confirmed || !activeConversation) return;

        try {
            if (message.threadType === "forum") {
                await api.delete(`/messages/${activeConversation.id}/messages/${message.id}`, true);
            } else {
                await api.delete(`/admin-employer/messages/${activeConversation.employerId}/${message.id}`, true);
            }

            setMessages((prev) => prev.filter((item) => item.id !== message.id));
            if (activeConversation.threadType === "forum") {
                await loadForumConversations();
            } else {
                await loadConversations();
            }
        } catch (err) {
            setError(err.message);
        }
    };

    const renderProfileAvatar = (profile) => {
        const imageUrl = getProfileAvatarUrl(profile);
        if (imageUrl) {
            return <img src={imageUrl} alt={profile?.name || "User"} />;
        }
        return <span>{profile?.name?.[0]?.toUpperCase() || "U"}</span>;
    };

    const getThreadMessageProfile = (message) => {
        if (message?.threadType === "forum") {
            return {
                name: message.sender?.name,
                avatar_url: message.sender?.avatar_url,
                admin_avatar_url: message.sender?.admin_avatar_url
            };
        }

        return message?.senderType === "admin"
            ? {
                name: activeConversation?.admin?.name || "Employer Admin",
                admin_avatar_url: activeConversation?.admin?.admin_avatar_url || null
            }
            : {
                name:
                    activeConversation?.employer?.organization_name ||
                    activeConversation?.employer?.name ||
                    "Employer",
                EmployerProfile: {
                    logo_url: activeConversation?.employer?.logo_url || null
                }
            };
    };

    return (
        <AdminShell
            scope="employer"
            title="Employer Messages"
            subtitle="Private one-on-one conversations with employers."
            onLogout={handleLogout}
        >
            <div className="messages-page admin-employer-messages-page">
                <div className="messages-shell">
                    <aside className="conversation-sidebar">
                        <div className="sidebar-heading">Employer Conversations</div>
                        <div className="employer-conversation-search">
                            <FiSearch aria-hidden="true" />
                            <input
                                type="search"
                                value={conversationSearch}
                                onChange={(event) => setConversationSearch(event.target.value)}
                                placeholder="Search users or conversations..."
                                aria-label="Search employer conversations"
                            />
                        </div>
                        <div className="employer-conversation-list">
                        {loadingConversations && (
                            <div className="sidebar-state">
                                <Spinner animation="border" size="sm" /> Loading conversations...
                            </div>
                        )}
                        {!loadingConversations && conversations.length === 0 && (
                            <div className="sidebar-state">
                                {forumConversations.length === 0 ? "No conversations yet." : "No employer conversations yet."}
                            </div>
                        )}
                        {!loadingConversations && combinedThreads.length > 0 && filteredThreads.length === 0 && (
                            <div className="sidebar-state">No conversations found.</div>
                        )}
                        {filteredThreads.map((conversation) => {
                            // Use participant_avatar_url from backend if available, otherwise fall back to employer.logo_url
                            const avatarUrl = conversation.threadType === "forum"
                                ? null
                                : conversation.participant_avatar_url || conversation.employer?.logo_url || null;
                            // For forum threads, use "F" placeholder; for private threads use initials from title
                            const avatarLabel = conversation.threadType === "forum"
                                ? "F"
                                : conversation.employer?.organization_name?.[0]?.toUpperCase() || conversation.name?.[0]?.toUpperCase() || "E";
                            return (
                                <button
                                    type="button"
                                    key={conversation.threadKey}
                                    className={`conversation-item ${conversation.threadKey === activeThread ? "active" : ""}`}
                                    onClick={() => setActiveThread(conversation.threadKey)}
                                >
                                    <div className="conversation-avatar">
                                        {avatarUrl ? (
                                            <img src={avatarUrl} alt={avatarLabel} className="conversation-avatar-img" />
                                        ) : (
                                            <span>{avatarLabel}</span>
                                        )}
                                    </div>
                                    <div className="conversation-copy">
                                        <div className="conversation-top">
                                            <strong>
                                                {conversation.threadType === "forum"
                                                    ? conversation.name || "Forum"
                                                    : conversation.employer?.organization_name || conversation.employer?.name || "Employer"}
                                            </strong>
                                            <span>{formatTimestamp(conversation.last_message_at)}</span>
                                        </div>
                                        <div className="conversation-preview">
                                            {conversation.threadType === "forum"
                                                ? conversation.last_message_preview || "Shared forum"
                                                : conversation.last_message_text || conversation.employer?.email || "No messages yet."}
                                        </div>
                                    </div>
                                </button>
                            );
                        })}
                        </div>
                    </aside>

                    <section className="chat-panel">
                        <div className="chat-header">
                            <div>
                                <h3>
                                    {activeConversation?.threadType === "forum"
                                        ? activeConversation?.name || "Forum"
                                        : activeConversation?.employer?.organization_name || "Select an employer"}
                                </h3>
                                <p>
                                    {activeConversation?.threadType === "forum"
                                        ? "Shared forum for authorized users."
                                        : activeConversation?.employer?.email || "Private Employer ↔ Employer Admin conversation."}
                                </p>
                            </div>
                        </div>

                        <div className="chat-stream" ref={chatStreamRef}>
                            {loadingMessages && (
                                <div className="chat-state">
                                    <Spinner animation="border" size="sm" /> Loading messages...
                                </div>
                            )}

                            {!loadingMessages && messages.length === 0 && (
                                <div className="chat-state">No messages yet. Start the conversation.</div>
                            )}

                            {messages.slice().sort((a, b) => {
                                const aDate = new Date(a.created_at || a.createdAt || 0);
                                const bDate = new Date(b.created_at || b.createdAt || 0);
                                return aDate - bDate;
                            }).map((message) => {
                                const isForumMessage = message.threadType === "forum";
                                const senderId = isForumMessage
                                    ? message.sender?.id
                                    : message.senderType === "admin"
                                        ? activeConversation?.admin?.id
                                        : activeConversation?.employer?.id;
                                const isSelf = isForumMessage
                                    ? Number(message.sender_id) === Number(currentUser?.id)
                                    : Number(message.senderId) === Number(currentUser?.id);
                                const rowClass = isSelf ? "message-row outgoing" : "message-row incoming";
                                return (
                                    <div key={message.id} className={rowClass}>
                                        {!isSelf && (
                                            <button
                                                type="button"
                                                className={`message-avatar ${senderId ? "is-clickable" : ""}`}
                                                onClick={() => {
                                                    if (senderId) {
                                                        openProfile(senderId);
                                                    }
                                                }}
                                            >
                                                {renderProfileAvatar(getThreadMessageProfile(message))}
                                            </button>
                                        )}

                                        <div className="message-content">
                                            <div className="message-meta">
                                                <div className="message-meta-left">
                                                    {isSelf ? (
                                                        <>
                                                            <span className="message-timestamp">{formatTimestamp(isForumMessage ? message.created_at : message.createdAt)}</span>
                                                            <button
                                                                type="button"
                                                                className={`message-author ${senderId ? "is-clickable" : ""}`}
                                                                onClick={() => {
                                                                    if (senderId) {
                                                                        openProfile(senderId);
                                                                    }
                                                                }}
                                                            >
                                                                {isForumMessage
                                                                    ? message.sender?.name || "User"
                                                                    : message.senderType === "admin"
                                                                        ? activeConversation?.admin?.name || "Employer Admin"
                                                                        : activeConversation?.employer?.organization_name || activeConversation?.employer?.name || "Employer"}
                                                            </button>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <button
                                                                type="button"
                                                                className={`message-author ${senderId ? "is-clickable" : ""}`}
                                                                onClick={() => {
                                                                    if (senderId) {
                                                                        openProfile(senderId);
                                                                    }
                                                                }}
                                                            >
                                                                {isForumMessage
                                                                    ? message.sender?.name || "User"
                                                                    : message.senderType === "admin"
                                                                        ? activeConversation?.admin?.name || "Employer Admin"
                                                                        : activeConversation?.employer?.organization_name || activeConversation?.employer?.name || "Employer"}
                                                            </button>
                                                            <span className="message-timestamp">{formatTimestamp(isForumMessage ? message.created_at : message.createdAt)}</span>
                                                        </>
                                                    )}
                                                </div>
                                            </div>

                                            <div className="message-bubble-wrapper">
                                                {(isForumMessage ? message.message_text : message.message) && (
                                                    <div className="message-bubble">
                                                {isForumMessage ? message.message_text : message.message}
                                                    </div>
                                                )}
                                                {isSelf && (
                                                    <MessageOptionsMenu
                                                        open={openMessageMenuId === message.id}
                                                        onToggle={() => setOpenMessageMenuId((current) => current === message.id ? null : message.id)}
                                                        onClose={() => setOpenMessageMenuId(null)}
                                                        onDelete={() => deleteMessage(message)}
                                                    />
                                                )}
                                            </div>

                                        </div>                                        {isSelf && (
                                            <button
                                                type="button"
                                                className="message-avatar"
                                                onClick={() => {
                                                    if (senderId) {
                                                        openProfile(senderId);
                                                    }
                                                }}
                                            >
                                                {renderProfileAvatar(getThreadMessageProfile(message))}
                                            </button>
                                        )}                                    </div>
                                );
                            })}
                        </div>

                        <div className="chat-composer">
                            <AttachmentSelectionPreview file={attachment} onRemove={() => { setAttachment(null); if (fileInputRef.current) fileInputRef.current.value = ""; }} />
                            <div className="composer-row">
                                <button
                                    type="button"
                                    className="attach-btn"
                                    onClick={() => fileInputRef.current?.click()}
                                    title="Add file"
                                >
                                    <FiPaperclip />
                                </button>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    hidden
                                    accept={ALLOWED_ATTACHMENT_TYPES}
                                    onChange={(e) => { const selected = e.target.files?.[0] || null; if (selected && selected.size > MAX_ATTACHMENT_BYTES) { setError(`This file is too large. Maximum attachment size is ${MAX_ATTACHMENT_MB} MB.`); e.target.value = ""; return; } setError(""); setAttachment(selected); }}
                                />
                                <Form.Control
                                    placeholder={
                                        activeConversation?.threadType === "forum"
                                            ? "Write a forum message..."
                                            : "Write a private message..."
                                    }
                                    value={draft}
                                    onChange={(e) => setDraft(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter" && !e.shiftKey) {
                                            e.preventDefault();
                                            sendMessage();
                                        }
                                    }}
                                />
                                <Button className="send-btn" onClick={sendMessage} disabled={sending || !activeConversation}>
                                    {sending ? <Spinner animation="border" size="sm" /> : <FiSend />}
                                </Button>
                            </div>
                        </div>
                    </section>
                </div>

                {error && <p className="messages-error">{error}</p>}
            </div>

            <Modal
                show={showProfileModal}
                onHide={() => {
                    setShowProfileModal(false);
                    setSelectedProfile(null);
                }}
                centered
            >
                <Modal.Header closeButton>
                    <Modal.Title>User Profile</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    {profileLoading && (
                        <div className="chat-state">
                            <Spinner animation="border" size="sm" /> Loading profile...
                        </div>
                    )}
                    {!profileLoading && selectedProfile && (
                        <div className="profile-modal">
                            <div className="profile-modal-avatar">
                                {renderProfileAvatar(selectedProfile)}
                            </div>
                            <h4>{selectedProfile.name}</h4>
                            <p>{selectedProfile.role}</p>
                            {selectedProfile.role === "admin" && (
                                <p>Office / Department: {selectedProfile.admin_department || "N/A"}</p>
                            )}
                            {selectedProfile.AlumniProfile?.course && (
                                <p>Course: {selectedProfile.AlumniProfile.course}</p>
                            )}
                            {selectedProfile.AlumniProfile?.graduation_year && (
                                <p>Batch Year: {selectedProfile.AlumniProfile.graduation_year}</p>
                            )}
                            {selectedProfile.EmployerProfile?.organization_name && (
                                <p>Organization: {selectedProfile.EmployerProfile.organization_name}</p>
                            )}
                            <p>
                                Visibility:{" "}
                                {selectedProfile.AlumniProfile?.profile_visibility || "public"}
                            </p>
                        </div>
                    )}
                </Modal.Body>
            </Modal>
        </AdminShell>
    );
}

