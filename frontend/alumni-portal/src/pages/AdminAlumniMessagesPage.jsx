import React, { useEffect, useMemo, useRef, useState } from "react";
import { Button, Form, Modal, Spinner } from "react-bootstrap";
import { FiPaperclip, FiSend } from "react-icons/fi";
import { useNavigate } from "react-router-dom";
import { api, API_BASE_URL } from "../services/api";
import useRenderDebug from "../hooks/useRenderDebug";
import useStrictSafeEffect from "../hooks/useStrictSafeEffect";
import useAdaptivePoll from "../hooks/useAdaptivePoll";
import { mergeUniqueById, replaceUniqueById } from "../utils/list";
import AdminShell from "../components/AdminShell";
import MessageOptionsMenu from "../components/MessageOptionsMenu";
import MessageAttachment from "../components/MessageAttachment";
import AttachmentSelectionPreview from "../components/AttachmentSelectionPreview";
import { ALLOWED_ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_MB } from "../utils/messageAttachments";
import "./MessagesPage.css";

const PAGE_SIZE = 30;

const formatTimestamp = (value) => {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString();
};

const previewAttachmentLabel = (message) => message.file_name || "Attachment";

const avatarLetter = (name = "U") => name[0]?.toUpperCase() || "U";

export default function AdminAlumniMessagesPage() {
    useRenderDebug("AdminAlumniMessagesPage");
    const navigate = useNavigate();
    const [forumConversation, setForumConversation] = useState(null);

    const handleLogout = () => {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        navigate("/");
    };

    const [messages, setMessages] = useState([]);
    const [openMessageMenuId, setOpenMessageMenuId] = useState(null);
    const [hasMore, setHasMore] = useState(false);
    const [draft, setDraft] = useState("");
    const [attachment, setAttachment] = useState(null);
    const [loadingConversation, setLoadingConversation] = useState(true);
    const [loadingMessages, setLoadingMessages] = useState(false);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState("");
    const [profileLoading, setProfileLoading] = useState(false);
    const [selectedProfile, setSelectedProfile] = useState(null);
    const [showProfileModal, setShowProfileModal] = useState(false);
    const fileInputRef = useRef(null);
    const chatStreamRef = useRef(null);
    const pendingScrollStateRef = useRef(null);

    const currentUser = useMemo(() => {
        try {
            return JSON.parse(localStorage.getItem("user") || "null");
        } catch {
            return null;
        }
    }, []);

    const areForumConversationsEqual = (prev, next) => {
        if (!prev || !next) return false;
        return (
            prev.id === next.id &&
            prev.name === next.name &&
            prev.last_message_at === next.last_message_at &&
            prev.last_message_preview === next.last_message_preview &&
            prev.unread_count === next.unread_count
        );
    };

    const loadForumConversation = async (isInitial = false) => {
        if (isInitial) {
            setLoadingConversation(true);
        }
        try {
            const data = await api.get("/messages/conversations", true);
            const forum = (Array.isArray(data) ? data : []).find((conversation) => conversation.type === "forum") || null;
            setForumConversation((prev) => {
                if (prev && forum && areForumConversationsEqual(prev, forum)) {
                    return prev;
                }
                return forum;
            });
        } catch (err) {
            setError(err.message);
        } finally {
            if (isInitial) {
                setLoadingConversation(false);
            }
        }
    };

    const markForumRead = async (conversationId) => {
        if (!conversationId) return;
        try {
            await api.post(`/messages/${conversationId}/read`, {}, true);
        } catch {
            // keep polling resilient
        }
    };

    const loadMessages = async (before = null, appendOlder = false) => {
        if (!forumConversation?.id) return;
        setLoadingMessages(true);
        try {
            const query = before ? `?limit=${PAGE_SIZE}&before=${before}` : `?limit=${PAGE_SIZE}`;
            const data = await api.get(`/messages/${forumConversation.id}${query}`, true);
            const nextMessages = Array.isArray(data?.messages) ? data.messages : [];
            setMessages((prev) => (appendOlder ? mergeUniqueById(prev, nextMessages, { prepend: true }) : replaceUniqueById(nextMessages)));
            setHasMore(Boolean(data?.has_more));
            if (!appendOlder) {
                await markForumRead(forumConversation.id);
            }
        } catch (err) {
            setError(err.message);
            if (!appendOlder) {
                setMessages([]);
            }
        } finally {
            setLoadingMessages(false);
        }
    };

    useEffect(() => {
        loadForumConversation(true);
    }, []);

    useEffect(() => {
        if (!forumConversation?.id) return;
        loadMessages();
    }, [forumConversation?.id]);

    useAdaptivePoll(
        async () => {
            if (!forumConversation?.id) return;
            await loadForumConversation();
        },
        {
            enabled: Boolean(forumConversation?.id),
            minDelay: 60000,
            hiddenDelay: 120000,
            maxDelay: 300000,
            singletonKey: "messages:conversations",
            deps: [forumConversation?.id]
        }
    );

    useEffect(() => {
        if (!chatStreamRef.current) return;
        const pendingScrollState = pendingScrollStateRef.current;
        if (pendingScrollState) {
            const delta = chatStreamRef.current.scrollHeight - pendingScrollState.scrollHeight;
            chatStreamRef.current.scrollTop = pendingScrollState.scrollTop + delta;
            pendingScrollStateRef.current = null;
            return;
        }
        chatStreamRef.current.scrollTo({
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

    const sendMessage = async () => {
        if (!forumConversation?.id || (!draft.trim() && !attachment)) return;
        setSending(true);
        setError("");
        try {
            const formData = new FormData();
            if (draft.trim()) formData.append("message_text", draft.trim());
            if (attachment) formData.append("attachment", attachment);

            const saved = await api.post(`/messages/${forumConversation.id}`, formData, true);
            setMessages((prev) => mergeUniqueById(prev, [saved]));
            setForumConversation((prev) =>
                prev
                    ? {
                        ...prev,
                        unread_count: 0,
                        last_message_preview: saved.message_text || saved.file_name || prev.last_message_preview,
                        last_message_at: saved.created_at || saved.createdAt || new Date().toISOString()
                    }
                    : prev
            );
            setDraft("");
            setAttachment(null);
            if (fileInputRef.current) fileInputRef.current.value = "";
        } catch (err) {
            setError(err.message);
        } finally {
            setSending(false);
        }
    };

    const loadOlderMessages = async () => {
        if (!messages.length) return;
        if (chatStreamRef.current) {
            pendingScrollStateRef.current = {
                scrollTop: chatStreamRef.current.scrollTop,
                scrollHeight: chatStreamRef.current.scrollHeight
            };
        }
        await loadMessages(messages[0].id, true);
    };

    const deleteMessage = async (messageId) => {
        if (!forumConversation?.id) return;
        const confirmed = window.confirm("Delete this message?");
        if (!confirmed) return;

        try {
            await api.delete(`/messages/${forumConversation.id}/messages/${messageId}`, true);
            setMessages((prev) => prev.filter((item) => item.id !== messageId));
            await loadForumConversation();
        } catch (err) {
            setError(err.message);
        }
    };

    const openAttachment = async (message) => {
        if (!message?.file_url) return;
        try {
            const token = localStorage.getItem("token");
            const response = await fetch(`${API_BASE_URL.replace(/\/api$/, "")}${message.file_url}`, {
                headers: token ? { Authorization: `Bearer ${token}` } : {}
            });
            if (!response.ok) {
                throw new Error("Unable to open attachment.");
            }
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            window.open(url, "_blank", "noopener,noreferrer");
            setTimeout(() => URL.revokeObjectURL(url), 60000);
        } catch (err) {
            setError(err.message);
        }
    };

    const renderAvatar = (person) => {
        const imageUrl = person?.avatar_url || person?.admin_avatar_url;
        if (imageUrl) {
            return <img src={imageUrl} alt={person?.name || "User"} />;
        }
        return <span>{avatarLetter(person?.name)}</span>;
    };

    return (
        <AdminShell
            scope="alumni"
            title="Alumni Messages"
            subtitle="Forum messaging for alumni administration."
            onLogout={handleLogout}
        >
            <div className="messages-page admin-employer-messages-page">
                <div className="messages-shell">
                    <aside className="conversation-sidebar">
                        <div className="sidebar-heading">Forum</div>
                        {loadingConversation && (
                            <div className="sidebar-state">
                                <Spinner animation="border" size="sm" /> Loading forum...
                            </div>
                        )}
                        {!loadingConversation && !forumConversation && (
                            <div className="sidebar-state">Forum is not available.</div>
                        )}
                        {forumConversation && (
                            <button
                                type="button"
                                className="conversation-item active"
                            >
                                <div className="conversation-avatar">
                                    <span className="conversation-avatar-letter">F</span>
                                </div>
                                <div className="conversation-copy">
                                    <div className="conversation-top">
                                        <strong>{forumConversation.name || "Forum"}</strong>
                                        <span>{formatTimestamp(forumConversation.last_message_at)}</span>
                                    </div>
                                    <div className="conversation-preview">
                                        {forumConversation.last_message_preview || "Shared forum for authorized users."}
                                    </div>
                                </div>
                                {forumConversation.unread_count > 0 && (
                                    <span className="conversation-badge">{forumConversation.unread_count}</span>
                                )}
                            </button>
                        )}
                    </aside>

                    <section className="chat-panel">
                        <div className="chat-header">
                            <div>
                                <h3>{forumConversation?.name || "Forum"}</h3>
                                <p>Shared forum for authorized users.</p>
                            </div>
                        </div>

                        <div className="chat-stream" ref={chatStreamRef}>
                            {hasMore && (
                                <button type="button" className="load-older-btn" onClick={loadOlderMessages}>
                                    Load older messages
                                </button>
                            )}

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
                                const isSelf = Number(message.sender_id) === Number(currentUser?.id);
                                return (
                                    <div key={message.id} className={`message-row ${isSelf ? "outgoing" : "incoming"}`}>
                                        {!isSelf && (
                                            <button
                                                type="button"
                                                className="message-avatar is-clickable"
                                                onClick={() => openProfile(message.sender?.id)}
                                            >
                                                {renderAvatar(message.sender)}
                                            </button>
                                        )}
                                        <div className="message-content">
                                            <div className="message-meta">
                                                <div className="message-meta-left">
                                                    {isSelf ? (
                                                        <>
                                                            <span>{formatTimestamp(message.created_at)}</span>
                                                            <button
                                                                type="button"
                                                                className="message-author is-clickable"
                                                                onClick={() => openProfile(message.sender?.id)}
                                                            >
                                                                {message.sender?.name || "User"}
                                                            </button>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <button
                                                                type="button"
                                                                className="message-author is-clickable"
                                                                onClick={() => openProfile(message.sender?.id)}
                                                            >
                                                                {message.sender?.name || "User"}
                                                            </button>
                                                            <span>{formatTimestamp(message.created_at)}</span>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="message-bubble-wrapper">
                                                {message.message_text && (
                                                    <div className="message-bubble">{message.message_text}</div>
                                                )}
                                                {isSelf && (
                                                    <MessageOptionsMenu
                                                        open={openMessageMenuId === message.id}
                                                        onToggle={() => setOpenMessageMenuId((current) => current === message.id ? null : message.id)}
                                                        onClose={() => setOpenMessageMenuId(null)}
                                                        onDelete={() => deleteMessage(message.id)}
                                                    />
                                                )}
                                            </div>
                                            {message.file_url && <MessageAttachment message={message} openAttachment={openAttachment} />}
                                        </div>                                        {isSelf && (
                                            <button
                                                type="button"
                                                className="message-avatar is-clickable"
                                                onClick={() => openProfile(message.sender?.id)}
                                            >
                                                {renderAvatar(message.sender)}
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
                                    placeholder="Write a forum message..."
                                    value={draft}
                                    onChange={(e) => setDraft(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter" && !e.shiftKey) {
                                            e.preventDefault();
                                            sendMessage();
                                        }
                                    }}
                                />
                                <Button className="send-btn" onClick={sendMessage} disabled={sending || !forumConversation}>
                                    {sending ? <Spinner animation="border" size="sm" /> : <FiSend />}
                                </Button>
                            </div>
                        </div>
                    </section>
                </div>

                {error && <p className="messages-error">{error}</p>}

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
                                    {renderAvatar({
                                        name: selectedProfile.name,
                                        avatar_url: getProfileAvatarUrl(selectedProfile),
                                        admin_avatar_url: selectedProfile.admin_avatar_url
                                    })}
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
            </div>
        </AdminShell>
    );
}

