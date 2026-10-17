import useChatViewport from "../hooks/useChatViewport";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Form, Modal, Spinner, Row, Col } from "react-bootstrap";
import { FiPaperclip, FiSend, FiUser, FiSearch, FiMessageSquare, FiArrowLeft } from "react-icons/fi";
import { io } from "socket.io-client";
import { api, API_BASE_URL, fetchFile } from "../services/api";
import useRenderDebug from "../hooks/useRenderDebug";
import useStrictSafeEffect from "../hooks/useStrictSafeEffect";
import useAdaptivePoll from "../hooks/useAdaptivePoll";
import { mergeUniqueById, replaceUniqueById } from "../utils/list";
import { formatMessageTimestamp, getConversationDisplayName } from "../utils/messaging";
import ConversationListItem from "../components/ConversationListItem";
import MessageOptionsMenu from "../components/MessageOptionsMenu";
import MessageAttachment from "../components/MessageAttachment";
import AttachmentSelectionPreview from "../components/AttachmentSelectionPreview";
import { ALLOWED_ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_MB, isImageAttachment } from "../utils/messageAttachments";
import "./MessagesPage.css";

const PAGE_SIZE = 30;

const previewAttachmentLabel = (message) => message.file_name || "Attachment";

const avatarLetter = (name = "U") => name[0]?.toUpperCase() || "U";

export default function MessagesPage() {
    useRenderDebug("MessagesPage");
    useChatViewport();
    const [viewerProfile, setViewerProfile] = useState(null);
    const [conversations, setConversations] = useState([]);
    const [activeConversationId, setActiveConversationId] = useState(null);
    const [messages, setMessages] = useState([]);
    const [openMessageMenuId, setOpenMessageMenuId] = useState(null);
    const [hasMore, setHasMore] = useState(false);
    const [draft, setDraft] = useState("");
    const [attachment, setAttachment] = useState(null);
    const [loadingConversations, setLoadingConversations] = useState(true);
    const [loadingMessages, setLoadingMessages] = useState(false);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState("");
    const [profileLoading, setProfileLoading] = useState(false);
    const [selectedProfile, setSelectedProfile] = useState(null);
    const [showProfileModal, setShowProfileModal] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState([]);
    const [searching, setSearching] = useState(false);
    const [showSearchResults, setShowSearchResults] = useState(false);
    const fileInputRef = useRef(null);
    const chatStreamRef = useRef(null);
    const pendingScrollStateRef = useRef(null);
    const preservedMessagesRef = useRef([]);
    const searchTimeoutRef = useRef(null);
    const socketRef = useRef(null);
    const activeConversationIdRef = useRef(null);

    const [isMobile, setIsMobile] = useState(false);
    const [mobileView, setMobileView] = useState("list"); // 'list' | 'chat' — on desktop we ignore this

    const currentUser = useMemo(() => {
        try {
            return JSON.parse(localStorage.getItem("user") || "null");
        } catch {
            return null;
        }
    }, []);

    // Keep ref in sync with state
    useEffect(() => {
        activeConversationIdRef.current = activeConversationId;
    }, [activeConversationId]);

    // Track viewport to enable mobile-friendly view switching
    useEffect(() => {
        const media = window.matchMedia('(max-width: 1024px)');
        const update = () => {
            setIsMobile(media.matches);
            setMobileView(media.matches ? 'list' : 'chat');
        };
        update();
        media.addEventListener('change', update);
        return () => media.removeEventListener('change', update);
    }, []);

    const openMobileChat = () => setMobileView('chat');
    const openMobileList = () => setMobileView('list');

    // helper used when user selects a conversation row
    const selectConversation = (conversationId) => {
        setActiveConversationId(conversationId);
        if (isMobile) {
            // show chat full-screen on mobile
            openMobileChat();
        }
    };

    const activeConversation = useMemo(
        () => conversations.find((item) => item.id === activeConversationId) || null,
        [conversations, activeConversationId]
    );

    const searchUsers = useCallback(async (query) => {
        if (!query || query.length < 2) {
            setSearchResults([]);
            setShowSearchResults(false);
            return;
        }
        setSearching(true);
        try {
            const data = await api.get(`/messages/search-users?q=${encodeURIComponent(query)}`, true);
            setSearchResults(Array.isArray(data) ? data : []);
            setShowSearchResults(true);
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
                setShowSearchResults(false);
                await loadConversations(true);
                setActiveConversationId(conversation.id);
                if (isMobile) openMobileChat();
            }
        } catch (err) {
            setError(err.message);
        }
    };

    const loadViewerProfile = useCallback(async () => {
        try {
            const data = await api.get("/profile", true);
            setViewerProfile(data);
        } catch (err) {
            setError(err.message);
        }
    }, []);

    const loadConversations = useCallback(async (isInitial = false) => {
        if (isInitial) setLoadingConversations(true);
        try {
            const data = await api.get("/messages/conversations", true);
            const list = Array.isArray(data) ? data : [];
            setConversations((prev) => {
                // Shallow compare to avoid unnecessary re-renders
                if (prev.length === list.length && prev.every((item, i) => item.id === list[i].id && item.unread_count === list[i].unread_count && item.last_message_at === list[i].last_message_at && item.last_message_preview === list[i].last_message_preview)) {
                    return prev;
                }
                return list;
            });
            setActiveConversationId((prev) => {
                if (prev && list.some((item) => item.id === prev)) return prev;
                return list[0]?.id || null;
            });
        } catch (err) {
            setError(err.message);
        } finally {
            if (isInitial) setLoadingConversations(false);
        }
    }, []);

    const markActiveConversationRead = useCallback(async (conversationId) => {
        if (!conversationId) return;
        try {
            await api.post(`/messages/${conversationId}/read`, {}, true);
            setConversations((prev) =>
                prev.map((item) =>
                    item.id === conversationId ? { ...item, unread_count: 0 } : item
                )
            );
        } catch {
            // keep polling resilient
        }
    }, []);

    const loadMessages = useCallback(
        async (conversationId, before = null, appendOlder = false) => {
            if (!conversationId) return;
            setLoadingMessages(true);
            try {
                const query = before ? `?limit=${PAGE_SIZE}&before=${before}` : `?limit=${PAGE_SIZE}`;
                const data = await api.get(`/messages/${conversationId}${query}`, true);
                const nextMessages = Array.isArray(data?.messages) ? data.messages : [];
                setMessages((prev) => {
                    const result = appendOlder ? mergeUniqueById(prev, nextMessages, { prepend: true }) : replaceUniqueById(nextMessages);
                    preservedMessagesRef.current = result;
                    return result;
                });
                setHasMore(Boolean(data?.has_more));
                if (!appendOlder) {
                    await markActiveConversationRead(conversationId);
                }
            } catch (err) {
                setError(err.message);
                if (!appendOlder && preservedMessagesRef.current.length) {
                    setMessages(preservedMessagesRef.current);
                } else if (!appendOlder) {
                    setMessages([]);
                }
            } finally {
                setLoadingMessages(false);
            }
        },
        [markActiveConversationRead]
    );

    useStrictSafeEffect(
        "MessagesPage:init",
        () => {
            loadViewerProfile();
            loadConversations(true);
            return undefined;
        },
        [loadViewerProfile, loadConversations],
        { label: "MessagesPage init" }
    );

    useEffect(() => {
        if (!activeConversationId) return;
        preservedMessagesRef.current = [];
        loadMessages(activeConversationId);
    }, [activeConversationId, loadMessages]);

    // ---- SOCKET.IO SETUP ----
    useEffect(() => {
        const token = localStorage.getItem("token");
        if (!token) return;

        const socketBase = API_BASE_URL.replace(/\/api$/, "");
        const socket = io(socketBase, {
            auth: { token },
            transports: ["websocket", "polling"]
        });

        socketRef.current = socket;

        socket.on("connect", () => {
            const userId = currentUser?.id || "unknown";
            const userCourse = currentUser?.AlumniProfile?.course || currentUser?.admin_scope || "N/A";
            console.log(`[SOCKET.IO] Client connected: user=${userId}, course=${userCourse}, socket=${socket.id}`);
            // Join the currently active conversation room
            if (activeConversationIdRef.current) {
                const room = `conversation:${activeConversationIdRef.current}`;
                console.log(`[SOCKET.IO] Client: user=${userId}, course=${userCourse}, socket=${socket.id} joining room ${room}`);
                socket.emit("join-conversation", activeConversationIdRef.current);
            }
        });

        socket.on("new-message", (message) => {
            const userId = currentUser?.id || "unknown";
            const userCourse = currentUser?.AlumniProfile?.course || currentUser?.admin_scope || "N/A";
            console.log(`[SOCKET.IO] Client received new-message: id=${message.id}, conversationId=${message.conversation_id}, activeConversationId=${activeConversationIdRef.current}, user=${userId}, course=${userCourse}`);
            // Only add the message if it matches the active conversation
            if (message.conversation_id === activeConversationIdRef.current) {
                setMessages((prev) => {
                    // Avoid duplicates
                    if (prev.some((m) => m.id === message.id)) {
                        console.log(`[SOCKET.IO] Client: message ${message.id} already in state, skipping`);
                        return prev;
                    }
                    const result = mergeUniqueById(prev, [message]);
                    preservedMessagesRef.current = result;
                    return result;
                });
                // Mark as read since we received it
                markActiveConversationRead(message.conversation_id);
            } else {
                console.log(`[SOCKET.IO] Client: message ${message.id} ignored because conversationId ${message.conversation_id} !== active ${activeConversationIdRef.current}`);
            }
            // Update conversation list (unread count, preview)
            setConversations((prev) =>
                prev.map((conv) => {
                    if (conv.id === message.conversation_id) {
                        const isActive = conv.id === activeConversationIdRef.current;
                        return {
                            ...conv,
                            last_message_preview: message.message_text || message.file_name || conv.last_message_preview,
                            last_message_at: message.created_at,
                            unread_count: isActive ? 0 : (conv.unread_count || 0) + 1
                        };
                    }
                    return conv;
                })
            );
        });

        socket.on("disconnect", (reason) => {
            console.log("[SOCKET.IO] Disconnected:", reason);
        });

        socket.on("connect_error", (err) => {
            console.error("[SOCKET.IO] Connection error:", err.message);
        });

        return () => {
            console.log("[SOCKET.IO] Cleaning up socket");
            socket.disconnect();
            socketRef.current = null;
        };
    }, []); // Only mount once

    // Join/leave conversation rooms when active conversation changes
    useEffect(() => {
        const socket = socketRef.current;
        if (!socket || !socket.connected) return;

        const userId = currentUser?.id || "unknown";
        const userCourse = currentUser?.AlumniProfile?.course || currentUser?.admin_scope || "N/A";

        // Leave previous room
        if (activeConversationIdRef.current && activeConversationIdRef.current !== activeConversationId) {
            console.log(`[SOCKET.IO] Client: user=${userId}, course=${userCourse}, socket=${socket.id} leaving room conversation:${activeConversationIdRef.current}`);
            socket.emit("leave-conversation", activeConversationIdRef.current);
        }

        // Join new room
        if (activeConversationId) {
            const room = `conversation:${activeConversationId}`;
            console.log(`[SOCKET.IO] Client: user=${userId}, course=${userCourse}, socket=${socket.id} joining room ${room}`);
            socket.emit("join-conversation", activeConversationId);
        }
    }, [activeConversationId, currentUser]);

    // Poll only conversations (unread counts + previews) - NOT messages
    // Messages are loaded once when conversation is opened and on send/delete
    useAdaptivePoll(
        async () => {
            await loadConversations();
        },
        {
            enabled: true,
            // reduced frequency to once per minute for conversation list polling
            minDelay: 60000,
            // when tab is hidden, poll much less frequently
            hiddenDelay: 120000,
            maxDelay: 300000,
            // ensure only a single shared poll for conversations across the app
            singletonKey: "messages:conversations",
            deps: [loadConversations]
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
            const merged =
                data?.role === "admin" && currentUser?.id === data?.id
                    ? {
                        ...data,
                        admin_department: data.admin_department || currentUser?.admin_department || "",
                        admin_avatar_url: data.admin_avatar_url || currentUser?.admin_avatar_url || ""
                    }
                    : data;
            setSelectedProfile(merged);
        } catch (err) {
            setError(err.message);
            setSelectedProfile(null);
        } finally {
            setProfileLoading(false);
        }
    };

    const sendMessage = async () => {
        if (!activeConversationId || (!draft.trim() && !attachment)) return;
        setSending(true);
        setError("");
        try {
            const formData = new FormData();
            if (draft.trim()) formData.append("message_text", draft.trim());
            if (attachment) formData.append("attachment", attachment);

            const saved = await api.post(`/messages/${activeConversationId}`, formData, true);
            setMessages((prev) => {
                const result = mergeUniqueById(prev, [saved]);
                preservedMessagesRef.current = result;
                return result;
            });
            setConversations((prev) =>
                prev.map((item) =>
                    item.id === activeConversationId
                        ? {
                            ...item,
                            unread_count: 0,
                            last_message_preview: saved.message_text || saved.file_name || item.last_message_preview,
                            last_message_at: saved.created_at
                        }
                        : item
                )
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
        if (!messages.length || !activeConversationId) return;
        if (chatStreamRef.current) {
            pendingScrollStateRef.current = {
                scrollTop: chatStreamRef.current.scrollTop,
                scrollHeight: chatStreamRef.current.scrollHeight
            };
        }
        await loadMessages(activeConversationId, messages[0].id, true);
    };

    const deleteMessage = async (messageId) => {
        if (!activeConversationId) return;
        const confirmed = window.confirm("Delete this message?");
        if (!confirmed) return;

        try {
            await api.delete(`/messages/${activeConversationId}/messages/${messageId}`, true);
            setMessages((prev) => {
                const result = prev.filter((item) => item.id !== messageId);
                preservedMessagesRef.current = result;
                return result;
            });
            await loadConversations();
        } catch (err) {
            setError(err.message);
        }
    };

    const openAttachment = async (message, disposition = "inline") => {
        if (!message?.file_url) return;
        try {
            const blob = await fetchFile(message.file_url, true);
            const url = URL.createObjectURL(blob);
            if (disposition === "download") {
                const link = document.createElement("a");
                link.href = url;
                link.download = message.file_name || "attachment";
                link.click();
            } else window.open(url, "_blank", "noopener,noreferrer");
            setTimeout(() => URL.revokeObjectURL(url), disposition === "download" ? 1000 : 60000);
        } catch (err) {
            setError(err.message);
        }
    };

    const renderAvatar = (person) => {
        if (person?.avatar_url) {
            return <img src={person.avatar_url} alt={person.name || "User"} />;
        }
        return <span>{avatarLetter(person?.name)}</span>;
    };

    const ConversationSkeleton = () => (
        <div className="conversation-item skeleton">
            <div className="conversation-avatar skeleton-circle" />
            <div className="conversation-copy">
                <div className="conversation-top skeleton-line skeleton-title" />
                <div className="conversation-preview skeleton-line skeleton-text" />
            </div>
        </div>
    );

    const MessageSkeleton = () => (
        <div className="message-row skeleton">
            <div className="message-avatar skeleton-circle" />
            <div className="message-body">
                <div className="message-meta">
                    <div className="skeleton-line skeleton-title" />
                    <div className="skeleton-line skeleton-text short" />
                </div>
                <div className="message-bubble skeleton-bubble" />
            </div>
        </div>
    );

    return (
        <div className={`messages-page ${isMobile ? `mobile-mode mobile-view-${mobileView}` : ''}`}>
            <div className="messages-topbar">
                <div>
                    <h2 className="messages-title">Messenger</h2>
                    <p className="messages-subtitle">
                        {viewerProfile?.role === "alumni"
                            ? "Forum, course community, and your batch group are ready."
                            : "Stay connected with the shared forum."}
                    </p>
                </div>
            </div>

            <div className="messages-shell">
                <aside className="conversation-sidebar">
                    <div className="sidebar-search">
                        <FiSearch className="sidebar-search-icon" />
                        <Form.Control
                            type="text"
                            placeholder="Search users to message..."
                            value={searchQuery}
                            onChange={handleSearchChange}
                            className="sidebar-search-input"
                        />
                        {searching && <Spinner animation="border" size="sm" className="sidebar-search-spinner" />}
                    </div>

                    {showSearchResults && searchResults.length > 0 && (
                        <div className="sidebar-search-results">
                            <div className="sidebar-search-header">Search Results</div>
                            {searchResults.map((user) => (
                                <button
                                    type="button"
                                    key={user.id}
                                    className="conversation-item search-result-item"
                                    onClick={() => startDirectConversation(user.id)}
                                >
                                    <div className="conversation-avatar">
                                        {user.avatar_url ? (
                                            <img src={user.avatar_url} alt={user.name} />
                                        ) : (
                                            <span>{avatarLetter(user.name)}</span>
                                        )}
                                    </div>
                                    <div className="conversation-copy">
                                        <div className="conversation-top">
                                            <strong>{user.name}</strong>
                                            <span className="user-role-tag">{user.role}</span>
                                        </div>
                                        <div className="conversation-preview">
                                            {user.organization_name || user.email}
                                            {user.graduation_year && user.course ? ` - ${user.graduation_year} ${user.course}` : ""}
                                        </div>
                                    </div>
                                    <FiMessageSquare className="start-chat-icon" />
                                </button>
                            ))}
                        </div>
                    )}

                    {showSearchResults && searchResults.length === 0 && searchQuery.length >= 2 && !searching && (
                        <div className="sidebar-search-results">
                            <div className="sidebar-state">No users found matching "{searchQuery}"</div>
                        </div>
                    )}

                    <div className="sidebar-heading">Conversations</div>
                    <div className="conversation-list">
                        {loadingConversations && (
                            <div className="sidebar-state">
                                <Spinner animation="border" size="sm" /> Loading conversations...
                            </div>
                        )}
                        {!loadingConversations && conversations.length === 0 && (
                            <div className="sidebar-state">No accessible conversations.</div>
                        )}
                        {loadingConversations && (
                            <div className="conversation-skeleton-list">
                                <ConversationSkeleton />
                                <ConversationSkeleton />
                                <ConversationSkeleton />
                            </div>
                        )}
                        {!loadingConversations && conversations.map((conversation) => {
                            const title = getConversationDisplayName(conversation, viewerProfile || currentUser);
                            const avatarFallback = conversation.type === "batch" ? "B" : conversation.type === "course" ? "C" : "F";
                            return (
                                <ConversationListItem
                                    key={conversation.id}
                                    conversation={conversation}
                                    title={title}
                                    avatarUrl={conversation.participant_avatar_url}
                                    avatarFallback={avatarFallback}
                                    active={conversation.id === activeConversationId}
                                    onSelect={() => selectConversation(conversation.id)}
                                />
                            );
                        })}
                    </div>
                </aside>

                <section className="chat-panel">
                    <div className="chat-header">
                        {isMobile && (
                            <button type="button" className="mobile-back-btn" onClick={() => openMobileList()} aria-label="Back to conversations">
                                <FiArrowLeft />
                            </button>
                        )}
                        {isMobile && activeConversation && (
                            <div className="chat-contact-avatar" aria-hidden="true">
                                {activeConversation.participant_avatar_url
                                    ? <img src={activeConversation.participant_avatar_url} alt="" />
                                    : <FiUser />}
                            </div>
                        )}
                        <div>
                            <h3>{activeConversation ? getConversationDisplayName(activeConversation, viewerProfile || currentUser) : "Select a conversation"}</h3>
                            <p>
                                {activeConversation?.type === "batch"
                                    ? "Only your verified batch and course can access this group."
                                    : activeConversation?.type === "course"
                                        ? "Only verified alumni from your course can access this community."
                                    : ["direct", "legacy"].includes(activeConversation?.type)
                                        ? "Direct conversation"
                                        : "Shared forum for authorized users."}
                            </p>
                        </div>
                    </div>

                    <div className="chat-stream" ref={chatStreamRef}>
                        {hasMore && (
                            <button type="button" className="load-older-btn" onClick={loadOlderMessages}>
                                Load older messages
                            </button>
                        )}

                        {loadingMessages && messages.length === 0 && (
                            <div className="chat-state">
                                <Spinner animation="border" size="sm" /> Loading messages...
                            </div>
                        )}

                        {loadingMessages && messages.length > 0 && (
                            <div className="chat-skeleton-list">
                                <MessageSkeleton />
                                <MessageSkeleton />
                                <MessageSkeleton />
                            </div>
                        )}

                        {!loadingMessages && messages.length === 0 && (
                            <div className="chat-state">No messages yet. Start the conversation.</div>
                        )}

                        {!loadingMessages && messages.slice().sort((a, b) => {
                            const aDate = new Date(a.created_at || a.createdAt || a.createdAtUTC || 0);
                            const bDate = new Date(b.created_at || b.createdAt || b.createdAtUTC || 0);
                            return aDate - bDate;
                        }).map((message) => {
                            const isOwnMessage = Number(message.sender_id) === Number(currentUser?.id);
                            const rowClass = `message-row ${isOwnMessage ? "outgoing" : "incoming"}${["direct", "legacy"].includes(activeConversation?.type) ? " direct-message" : ""}`;
                            return (
                                <div key={message.id} className={rowClass}>
                                    {!isOwnMessage && (
                                        <button
                                            type="button"
                                            className="message-avatar"
                                            onClick={() => openProfile(message.sender?.id)}
                                        >
                                            {renderAvatar(message.sender)}
                                        </button>
                                    )}

                                    <div className="message-content">
                                        <div className="message-meta">
                                            <div className="message-meta-left">
                                                <button
                                                    type="button"
                                                    className="message-author"
                                                    onClick={() => openProfile(message.sender?.id)}
                                                >
                                                    {message.sender?.name || "User"}
                                                </button>
                                                <span className="message-timestamp">{formatMessageTimestamp(message.created_at)}</span>
                                            </div>
                                        </div>

                                        <div className={`message-bubble-wrapper${isImageAttachment(message) ? " has-image" : ""}`}>
                                            {message.message_text && <div className="message-bubble">{message.message_text}</div>}
                                            {isOwnMessage && (
                                                <MessageOptionsMenu
                                                    open={openMessageMenuId === message.id}
                                                    onToggle={() => setOpenMessageMenuId((current) => current === message.id ? null : message.id)}
                                                    onClose={() => setOpenMessageMenuId(null)}
                                                    onDelete={() => deleteMessage(message.id)}
                                                />
                                            )}
                                            {message.file_url && isImageAttachment(message) && <MessageAttachment message={message} openAttachment={openAttachment} />}
                                        </div>

                                        {message.file_url && !isImageAttachment(message) && <MessageAttachment message={message} openAttachment={openAttachment} />}
                                    </div>

                                    {isOwnMessage && (
                                        <button
                                            type="button"
                                            className="message-avatar"
                                            onClick={() => openProfile(message.sender?.id)}
                                        >
                                            {renderAvatar(message.sender)}
                                        </button>
                                    )}
                                </div>
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
                                onChange={(e) => {
                                    const selected = e.target.files?.[0] || null;
                                    if (selected && selected.size > MAX_ATTACHMENT_BYTES) {
                                        setError(`This file is too large. Maximum attachment size is ${MAX_ATTACHMENT_MB} MB.`);
                                        e.target.value = "";
                                        return;
                                    }
                                    setError("");
                                    setAttachment(selected);
                                }}
                            />
                            <Form.Control
                                as={isMobile ? "textarea" : "input"}
                                rows={1}
                                placeholder="Write a message..."
                                value={draft}
                                onChange={(e) => {
                                    setDraft(e.target.value);
                                    if (isMobile) {
                                        e.target.style.height = "auto";
                                        e.target.style.height = `${Math.min(e.target.scrollHeight, 100)}px`;
                                    }
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" && !e.shiftKey) {
                                        e.preventDefault();
                                        sendMessage();
                                    }
                                }}
                            />
                            <Button className="send-btn" onClick={sendMessage} disabled={sending}>
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
                                    avatar_url:
                                        selectedProfile.admin_avatar_url ||
                                        selectedProfile.AlumniProfile?.avatar_url ||
                                        selectedProfile.EmployerProfile?.logo_url
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
    );
}
