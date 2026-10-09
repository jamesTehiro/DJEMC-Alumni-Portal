import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Modal } from "react-bootstrap";
import "./FeedPage.css";
import { api } from "../services/api";
import useRenderDebug from "../hooks/useRenderDebug";
import useStrictSafeEffect from "../hooks/useStrictSafeEffect";
import { FiImage, FiMessageCircle, FiSend } from "react-icons/fi";
import { useUndoDelete } from "../hooks/useUndoDelete";
import ProfileActionMenu from "../components/profile/ProfileActionMenu";
import ProfilePreviewModal from "../components/profile/ProfilePreviewModal";

export default function FeedPage() {
    useRenderDebug("FeedPage");
    const navigate = useNavigate();
    const [posts, setPosts] = useState([]);
    const [text, setText] = useState("");
    const [image, setImage] = useState(null);
    const [activeJob, setActiveJob] = useState(null);
    const [loading, setLoading] = useState(true);
    const [loadingMorePosts, setLoadingMorePosts] = useState(false);
    const [error, setError] = useState("");
    const [actionMessage, setActionMessage] = useState("");
    const { scheduleDelete } = useUndoDelete();
    const [commentDrafts, setCommentDrafts] = useState({});
    const [openCommentPosts, setOpenCommentPosts] = useState({});
    const [commentCursors, setCommentCursors] = useState({});
    const [commentHasMore, setCommentHasMore] = useState({});
    const [loadingMoreComments, setLoadingMoreComments] = useState({});
    const [selectedProfile, setSelectedProfile] = useState(null);
    const [profileMenuPostId, setProfileMenuPostId] = useState(null);
    const [profileMenuAnchor, setProfileMenuAnchor] = useState(null);
    const [profilePreviewUserId, setProfilePreviewUserId] = useState(null);
    const [postMenuOpenId, setPostMenuOpenId] = useState(null);
    const avatarRefs = useRef({});
    const authorBtnRefs = useRef({});
    const commentAvatarRefs = useRef({});
    const commentAuthorRefs = useRef({});
    const [postsCursor, setPostsCursor] = useState(null);
    const [hasMorePosts, setHasMorePosts] = useState(false);
    const [editingPost, setEditingPost] = useState(null);
    const [editText, setEditText] = useState("");
    const [editImage, setEditImage] = useState(null);
    const [editImagePreview, setEditImagePreview] = useState("");
    const [editSaving, setEditSaving] = useState(false);
    const fileInputRef = useRef(null);
    const editFileInputRef = useRef(null);
    const postMenuRef = useRef(null);

    const currentUser = useMemo(() => {
        try {
            return JSON.parse(localStorage.getItem("user") || "null");
        } catch {
            return null;
        }
    }, []);

    const currentName = currentUser?.name || "James";
    const currentInitial = currentName[0]?.toUpperCase() || "J";

    const getRoleLabel = (role, adminScope = "") => {
        if (role === "admin" || adminScope) return "Admin";
        if (role === "employer") return "Employer";
        if (role === "alumni") return "Alumni";
        return "User";
    };

    const getDetailedRoleLabel = (role, adminScope = "") => {
        if (role === "admin" && adminScope) {
            const normalized = String(adminScope).trim().toLowerCase();
            if (normalized === "employer") return "Admin · Employer";
            if (normalized === "alumni") return "Admin · Alumni";
            return `Admin · ${adminScope}`;
        }
        if (role === "admin") return "Admin";
        if (role === "employer") return "Employer";
        if (role === "alumni") return "Alumni";
        return "User";
    };

    const getProfileImage = (user) => {
        if (!user) return "";

        // Admin-employer/admin-alumni profiles should always prefer the admin avatar.
        if (user.role === "admin" || user.admin_scope) {
            return user.admin_avatar_url || "";
        }

        return user?.AlumniProfile?.avatar_url || user?.EmployerProfile?.logo_url || "";
    };

    const getAuthorProfile = (user, fallbackRole = "alumni") => ({
        id: user?.id || null,
        name: user?.name || (fallbackRole === "admin" ? "DJEMC Admin" : fallbackRole === "employer" ? "Employer" : "Alumni"),
        role: user?.role || fallbackRole,
        adminScope: user?.admin_scope || "",
        imageUrl: getProfileImage(user),
        label: getDetailedRoleLabel(user?.role || fallbackRole, user?.admin_scope)
    });

    // Show the ProfileActionMenu anchored to a button
    const openProfileMenu = (postId, anchorKey) => {
        if (!postId) return;
        setProfileMenuPostId(postId);
        setProfileMenuAnchor(anchorKey);
    };

    // Get the profile data for a given post
    const getPostProfile = (post) => ({
        id: post.authorId != null ? Number(post.authorId) : null,
        name: post.author,
        role: post.role,
        adminScope: post.adminScope,
        imageUrl: post.authorImage
    });

    // Handle "View Profile" action from ProfileActionMenu
    const handleViewProfile = (profile) => {
        if (!profile?.id) return;
        setProfilePreviewUserId(profile.id);
    };

    // Handle "Message" action from ProfileActionMenu
    const handleMessage = async (profile) => {
        if (!profile?.id || !currentUser?.id) return;
        const targetId = Number(profile.id);
        if (!Number.isInteger(targetId) || targetId <= 0) return;
        if (targetId === Number(currentUser.id)) return;
        let conversation = null;
        try {
            conversation = await api.post("/messages/direct", { targetUserId: targetId }, true);
        } catch (err) {
            const message = err?.message || "Unable to start conversation.";
            if (message.includes("Invalid target user")) {
                setActionMessage("Invalid target user. They may no longer be available for messaging.");
            } else {
                setActionMessage(message);
            }
            return;
        }

        const conversationId = conversation?.id || conversation?.conversation?.id;
        if (!conversationId) {
            setActionMessage("Conversation could not be opened.");
            return;
        }

        navigate(`/messages?conversation=${conversationId}`);
    };

    const openProfile = (profile) => {
        if (!profile?.id) return;
        setSelectedProfile(profile);
    };

    const mapAlumniPost = (item) => ({
        id: `post-${item.id}`,
        sourceId: item.id,
        type: "post",
        author: item.User?.name || "Alumni",
        role: item.User?.role === "admin" || item.User?.admin_scope ? "admin" : (item.User?.role || "alumni"),
        adminScope: item.User?.admin_scope || "",
        authorId: item.User?.id || null,
        authorImage: getProfileImage(item.User),
        text: item.text || "",
        image: item.image_url || "",
        comments: [],
        commentCount: Number(item.comment_count || 0),
        likes: 0,
        createdAt: item.createdAt || "",
        likedByMe: false
    });

    const mergeFeedItems = (currentItems, nextItems) => {
        const merged = [...currentItems];
        const seen = new Set(currentItems.map((item) => item.id));
        nextItems.forEach((item) => {
            if (!seen.has(item.id)) {
                merged.push(item);
                seen.add(item.id);
            }
        });
        return merged.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    };

    const fetchPostPage = async (cursor = null) => {
        const query = new URLSearchParams({ limit: "20" });
        if (cursor) query.set("cursor", String(cursor));
        const payload = await api.get(`/posts?${query.toString()}`);
        const items = Array.isArray(payload?.items) ? payload.items : [];
        return {
            items: items.map(mapAlumniPost),
            nextCursor: payload?.next_cursor || null,
            hasMore: Boolean(payload?.has_more)
        };
    };

    const normalizeComments = (items = []) =>
        items.map((c) => ({
            ...c,
            author: getAuthorProfile(c.User, c.User?.role || "alumni")
        }));

    const fetchCommentsPage = async (postId, cursor = null) => {
        const query = new URLSearchParams({ limit: "10" });
        if (cursor) query.set("cursor", String(cursor));
        const payload = await api.get(`/posts/${postId}/comments?${query.toString()}`, true);
        const items = Array.isArray(payload?.items) ? payload.items : Array.isArray(payload) ? payload : [];
        return {
            items: normalizeComments(items),
            nextCursor: payload?.next_cursor || null,
            hasMore: Boolean(payload?.has_more)
        };
    };

    useStrictSafeEffect(
        "FeedPage:init",
        () => {
            const loadFeed = async () => {
                try {
                    const [announcementsResult, jobsResult, userPostsResult] = await Promise.allSettled([
                        api.get("/announcements"),
                        api.get("/jobs"),
                        fetchPostPage()
                    ]);

                    const announcements = announcementsResult.status === "fulfilled" ? announcementsResult.value : [];
                    const jobs = jobsResult.status === "fulfilled" ? jobsResult.value : [];
                    const userPosts = userPostsResult.status === "fulfilled"
                        ? userPostsResult.value
                        : { items: [], nextCursor: null, hasMore: false };

                    if (announcementsResult.status === "rejected") {
                        // Keep the rest of the feed usable if announcements fail.
                        console.warn("Failed to load announcements:", announcementsResult.reason);
                    }
                    if (jobsResult.status === "rejected") {
                        // Jobs should not block alumni feed content.
                        console.warn("Failed to load jobs:", jobsResult.reason);
                    }
                    if (userPostsResult.status === "rejected") {
                        console.warn("Failed to load posts:", userPostsResult.reason);
                    }

                    const announcementPosts = (Array.isArray(announcements) ? announcements : []).map((item) => ({
                        id: `announcement-${item.id}`,
                        sourceId: item.id,
                        type: "announcement",
                        author: item.admin?.name || "DJEMC Admin",
                        role: item.admin?.role || "admin",
                        adminScope: item.admin?.admin_scope || "",
                        authorId: item.admin?.id || null,
                        authorImage: getProfileImage(item.admin),
                        title: item.title || "Announcement",
                        eventDay: item.day || "",
                        eventTime: item.time || "",
                        eventLocation: item.location || "",
                        description: item.content || "",
                        text: item.content || item.title || "",
                        image: "",
                        comments: (item.Comments || []).map((c) => ({
                            ...c,
                            author: getAuthorProfile(c.User, "alumni")
                        })),
                        commentCount: (item.Comments || []).length,
                        likes: 0,
                        createdAt: item.createdAt || "",
                        likedByMe: false
                    }));

                    const jobPosts = (Array.isArray(jobs) ? jobs : []).map((item) => ({
                        id: `job-${item.id}`,
                        sourceId: item.id,
                        type: "job",
                        author: item.User?.name || "Employer",
                        role: item.User?.role === "admin" || item.User?.admin_scope ? "admin" : "employer",
                        adminScope: item.User?.admin_scope || "",
                        authorId: item.User?.id || null,
                        authorImage: getProfileImage(item.User),
                        text: item.description || item.title || "",
                        image: "",
                        jobTitle: item.title,
                        comments: [],
                        commentCount: 0,
                        likes: 0,
                        createdAt: item.createdAt || "",
                        likedByMe: false
                    }));

                    const alumniPosts = Array.isArray(userPosts.items) ? userPosts.items : [];

                    const merged = [...announcementPosts, ...jobPosts, ...alumniPosts].sort((a, b) => {
                        return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
                    });

                    setPosts(merged);
                    setPostsCursor(userPosts.nextCursor);
                    setHasMorePosts(userPosts.hasMore);
                } catch (err) {
                    setError(err.message);
                } finally {
                    setLoading(false);
                }
            };

            loadFeed();
            return undefined;
        },
        [],
        { label: "FeedPage init" }
    );

    const fileToDataUrl = (file) =>
        new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });

    const submitPost = async () => {
        if (!text.trim() && !image) return;

        try {
            const imageUrl = image ? await fileToDataUrl(image) : "";
            const created = await api.post(
                "/posts",
                { text, image_url: imageUrl },
                true
            );

            const newPost = {
                id: `post-${created.id}`,
                sourceId: created.id,
                type: "post",
                author: created.User?.name || currentName,
                role: created.User?.role === "admin" || created.User?.admin_scope ? "admin" : (created.User?.role || "alumni"),
                adminScope: created.User?.admin_scope || "",
                authorId: created.User?.id || currentUser?.id || null,
                authorImage: getProfileImage(created.User) || getProfileImage(currentUser),
                text: created.text || text,
                image: created.image_url || imageUrl,
                comments: [],
                commentCount: 0,
                likes: 0,
                createdAt: created.createdAt || new Date().toISOString(),
                likedByMe: false
            };

            setPosts((prev) => [newPost, ...prev]);
            setText("");
            setImage(null);
        } catch (err) {
            setActionMessage(err.message);
        }
    };

    const addComment = async (postId, text) => {
        if (!text || !text.trim()) return;
        const post = posts.find((p) => p.id === postId);
        if (!post) return;

        try {
            if (post.type === "post") {
                const created = await api.post(`/posts/${post.sourceId}/comments`, { comment: text }, true);
                setPosts((prev) =>
                    prev.map((p) =>
                        p.id === postId
                            ? {
                                ...p,
                                comments: [...(p.comments || []), ...normalizeComments([created])],
                                commentCount: (p.commentCount || 0) + 1
                            }
                            : p
                    )
                );
            } else if (post.type === "announcement") {
                await api.post("/comments", { announcement_id: post.sourceId, comment: text }, true);
                setPosts((prev) =>
                    prev.map((p) =>
                        p.id === postId
                            ? {
                                ...p,
                                comments: [...(p.comments || []), { comment: text, User: currentUser, author: getAuthorProfile(currentUser, "alumni") }],
                                commentCount: (p.commentCount || 0) + 1
                            }
                            : p
                    )
                );
            }
            setCommentDrafts((prev) => ({ ...prev, [postId]: "" }));
        } catch (err) {
            setActionMessage(err.message);
        }
    };

    const toggleLike = (postId) => {
        setPosts((prev) =>
            prev.map((p) => {
                if (p.id !== postId) return p;
                const likedByMe = !p.likedByMe;
                return {
                    ...p,
                    likedByMe,
                    likes: Math.max(0, (p.likes || 0) + (likedByMe ? 1 : -1))
                };
            })
        );
    };

    const canOpenComments = (post) => {
        const isAlumniPost = post?.type === "post" && (post?.role === "alumni" || (post?.role === "admin" && post?.adminScope === "alumni"));
        const isAnnouncementFromAlumniAdmin = post?.type === "announcement" && post?.role === "admin" && post?.adminScope === "alumni";
        return isAlumniPost || isAnnouncementFromAlumniAdmin;
    };

    const toggleCommentComposer = async (post) => {
        if (!canOpenComments(post)) return;
        const nextOpen = !openCommentPosts[post.id];
        setOpenCommentPosts((prev) => ({
            ...prev,
            [post.id]: nextOpen
        }));

        if (nextOpen && post.type === "post" && !post.comments?.length && (post.commentCount || 0) > 0) {
            try {
                const refreshed = await fetchCommentsPage(post.sourceId);
                setPosts((prev) =>
                    prev.map((p) =>
                        p.id === post.id
                            ? {
                                ...p,
                                comments: refreshed.items,
                                commentCount: refreshed.items.length > (p.commentCount || 0) ? refreshed.items.length : p.commentCount || 0
                            }
                            : p
                    )
                );
                setCommentCursors((prev) => ({ ...prev, [post.id]: refreshed.nextCursor }));
                setCommentHasMore((prev) => ({ ...prev, [post.id]: refreshed.hasMore }));
            } catch (err) {
                setActionMessage(err.message);
            }
        }
    };

    const loadMoreComments = async (post) => {
        const cursor = commentCursors[post.id];
        if (!cursor || loadingMoreComments[post.id]) return;

        try {
            setLoadingMoreComments((prev) => ({ ...prev, [post.id]: true }));
            const nextPage = await fetchCommentsPage(post.sourceId, cursor);
            setPosts((prev) =>
                prev.map((p) =>
                    p.id === post.id
                        ? {
                            ...p,
                            comments: [...nextPage.items, ...(p.comments || [])]
                        }
                        : p
                )
            );
            setCommentCursors((prev) => ({ ...prev, [post.id]: nextPage.nextCursor }));
            setCommentHasMore((prev) => ({ ...prev, [post.id]: nextPage.hasMore }));
        } catch (err) {
            setActionMessage(err.message);
        } finally {
            setLoadingMoreComments((prev) => ({ ...prev, [post.id]: false }));
        }
    };

    const loadMorePosts = async () => {
        if (!hasMorePosts || !postsCursor || loadingMorePosts) return;

        try {
            setLoadingMorePosts(true);
            const nextPage = await fetchPostPage(postsCursor);
            setPosts((prev) => mergeFeedItems(prev, nextPage.items));
            setPostsCursor(nextPage.nextCursor);
            setHasMorePosts(nextPage.hasMore);
        } catch (err) {
            setActionMessage(err.message);
        } finally {
            setLoadingMorePosts(false);
        }
    };

    const canEditPost = (post) =>
        post?.type === "post" &&
        currentUser?.id &&
        Number(currentUser.id) === Number(post?.authorId);

    const canDeletePost = (post) => {
        if (post?.type !== "post") return false;
        if (currentUser?.id && Number(currentUser.id) === Number(post?.authorId)) return true;
        return currentUser?.role === "admin" && String(currentUser?.admin_scope || "").toLowerCase() === "alumni";
    };

    const togglePostMenu = (postId) => {
        setPostMenuOpenId((prev) => (prev === postId ? null : postId));
    };

    useEffect(() => {
        const handleOutsideClick = (event) => {
            if (!postMenuOpenId) return;
            if (postMenuRef.current && !postMenuRef.current.contains(event.target)) {
                setPostMenuOpenId(null);
            }
        };

        document.addEventListener("mousedown", handleOutsideClick);
        return () => document.removeEventListener("mousedown", handleOutsideClick);
    }, [postMenuOpenId]);

    const startEditPost = (post) => {
        setPostMenuOpenId(null);
        setEditingPost(post);
        setEditText(post?.text || "");
        setEditImage(null);
        setEditImagePreview(post?.image || "");
    };

    const closeEditPost = () => {
        setEditingPost(null);
        setEditText("");
        setEditImage(null);
        setEditImagePreview("");
    };

    const savePostEdit = async () => {
        if (!editingPost?.sourceId) return;
        setEditSaving(true);
        try {
            const imageUrl = editImage ? editImagePreview : editingPost.image || "";
            const updated = await api.put(
                `/posts/${editingPost.sourceId}`,
                { text: editText, image_url: imageUrl },
                true
            );

            setPosts((prev) =>
                prev.map((post) =>
                    post.id === editingPost.id
                        ? {
                            ...post,
                            text: updated?.text ?? editText,
                            image: updated?.image_url ?? imageUrl
                        }
                        : post
                )
            );
            setActionMessage("Post updated.");
            closeEditPost();
        } catch (err) {
            setActionMessage(err.message);
        } finally {
            setEditSaving(false);
        }
    };

    const handleDeletePost = (post) => {
        if (!post?.sourceId) return;

        // Remove from UI immediately
        setPosts((prev) => prev.filter((item) => item.id !== post.id));
        setPostMenuOpenId(null);

        scheduleDelete({
            item: post,
            itemName: "Post",
            message: "The post was deleted.",
            deleteAction: () => api.delete(`/posts/${post.sourceId}`, true),
            restoreAction: () => {
                setPosts((prev) => {
                    const exists = prev.find((p) => p.id === post.id);
                    if (exists) return prev;
                    return [post, ...prev].slice(0, 100);
                });
            },
        });
    };

    const submitApplication = async () => {
        if (!activeJob?.sourceId) return;
        try {
            await api.post("/applications", { job_id: activeJob.sourceId }, true);
            setActionMessage("Application submitted.");
            setActiveJob(null);
        } catch (err) {
            setActionMessage(err.message);
        }
    };

    const formatDate = (iso) => {
        if (!iso) return "";
        const date = new Date(iso);
        if (Number.isNaN(date.getTime())) return "";
        return date.toLocaleDateString("en-US");
    };

    const formatAnnouncementDate = (value) => {
        if (!value) return "To be announced";
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return value;
        return date.toLocaleDateString("en-US", {
            month: "long",
            day: "numeric",
            year: "numeric"
        });
    };

    const formatAnnouncementTime = (value) => {
        if (!value) return "To be announced";
        const [hours, minutes] = String(value).split(":");
        if (hours === undefined || minutes === undefined) return value;
        const date = new Date();
        date.setHours(Number(hours), Number(minutes), 0, 0);
        if (Number.isNaN(date.getTime())) return value;
        return date.toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit"
        });
    };

    const badgeLabel = (role, adminScope = "") => {
        if (role === "admin" || adminScope) return "Admin";
        if (role === "employer") return "Employer";
        return "Alumni";
    };

    const adminScopeLabel = (role, adminScope = "") => {
        if (role !== "admin" || !adminScope) return "";
        const normalized = String(adminScope).trim().toLowerCase();
        if (normalized === "employer") return "Admin \u00b7 Employer";
        if (normalized === "alumni") return "Admin \u00b7 Alumni";
        return `Admin \u00b7 ${adminScope}`;
    };

    return (
        <>
            <div className="feed-container">
                <div className="create-post">
                    <div className="composer-header">
                        <div className="avatar dark">{currentInitial}</div>
                        <div className="composer-prompt">Create Post</div>
                    </div>

                    <textarea
                        placeholder={`What's on your mind, ${currentName}?`}
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                    />

                    <input
                        ref={fileInputRef}
                        type="file"
                        className="hidden-file-input"
                        onChange={(e) => setImage(e.target.files[0])}
                    />

                    {image && <div className="image-chip">{image.name}</div>}

                    <div className="composer-actions">
                        <div className="left-icons">
                            <button
                                type="button"
                                className="icon-btn"
                                onClick={() => fileInputRef.current?.click()}
                                title="Add image"
                            >
                                <FiImage />
                                <span>Add image</span>
                            </button>
                        </div>

                        <button className="post-btn" onClick={submitPost}>
                            <FiSend />
                            <span>Post</span>
                        </button>
                    </div>
                </div>

                {loading && <p>Loading feed...</p>}
                {error && <p>{error}</p>}

                {posts.map((post) => (
                    <div key={post.id} className={`post-card ${post.role}`}>
                        <div className="post-header">
                            <button
                                type="button"
                                ref={(el) => { avatarRefs.current[post.id] = el; }}
                                className={`avatar dark profile-trigger ${post.authorId ? "is-clickable" : ""}`}
                                onClick={() => {
                                    if (!post.authorId) return;
                                    openProfileMenu(post.id, `avatar-${post.id}`);
                                }}
                                disabled={!post.authorId}
                                aria-label={`Open ${post.author} profile`}
                            >
                                {post.authorImage ? (
                                    <img src={post.authorImage} alt={post.author} className="profile-avatar-image" />
                                ) : (
                                    post.author[0]?.toUpperCase() || "U"
                                )}
                            </button>

                            <div className="meta">
                                <div className="author-row">
                                    <button
                                        type="button"
                                        ref={(el) => { authorBtnRefs.current[post.id] = el; }}
                                        className={`author author-btn ${post.authorId ? "is-clickable" : ""}`}
                                        onClick={() => {
                                            if (!post.authorId) return;
                                            openProfileMenu(post.id, `author-${post.id}`);
                                        }}
                                        disabled={!post.authorId}
                                    >
                                        {post.author}
                                    </button>
                                    <span className={`badge-tag ${post.role}`}>{badgeLabel(post.role, post.adminScope)}</span>
                                    {post.adminScope && post.role === "admin" && (
                                        <span className="badge-tag secondary">{adminScopeLabel(post.role, post.adminScope)}</span>
                                    )}
                                </div>
                                <div className="timestamp">{formatDate(post.createdAt)}</div>
                            </div>

                            {post.type === "post" && (canEditPost(post) || canDeletePost(post)) && (
                                <div className="post-actions" ref={postMenuRef}>
                                    <button
                                        type="button"
                                        className="post-actions-trigger"
                                        onClick={() => togglePostMenu(post.id)}
                                        aria-label="Post actions"
                                    >
                                        ...
                                    </button>
                                    {postMenuOpenId === post.id && (
                                        <div className="post-actions-menu">
                                            {canEditPost(post) && (
                                                <button type="button" onClick={() => startEditPost(post)}>
                                                    Edit
                                                </button>
                                            )}
                                            {canDeletePost(post) && (
                                                <button type="button" className="danger" onClick={() => handleDeletePost(post)}>
                                                    Delete
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {post.type === "announcement" ? (
                            <div className="announcement-card-body">
                                <h3 className="announcement-title">{post.title || "Announcement"}</h3>
                                <div className="announcement-meta-grid">
                                    <div className="announcement-meta-item">
                                        <span className="announcement-meta-label">Date</span>
                                        <strong>{formatAnnouncementDate(post.eventDay)}</strong>
                                    </div>
                                    <div className="announcement-meta-item">
                                        <span className="announcement-meta-label">Time</span>
                                        <strong>{formatAnnouncementTime(post.eventTime)}</strong>
                                    </div>
                                    <div className="announcement-meta-item announcement-meta-item-wide">
                                        <span className="announcement-meta-label">Location</span>
                                        <strong>{post.eventLocation || "To be announced"}</strong>
                                    </div>
                                </div>
                                <div className="announcement-description-block">
                                    <span className="announcement-meta-label">Description</span>
                                    <p className="post-text announcement-description">
                                        {post.description || "No description provided."}
                                    </p>
                                </div>
                            </div>
                        ) : (
                            <p className="post-text">{post.text}</p>
                        )}

                        {post.image && <img src={post.image} alt="post" className="post-image" />}

                        {post.type === "job" ? (
                            <div className="post-footer">
                                <button type="button" className="footer-action interested-action" onClick={() => navigate("/jobs")}>
                                    <span>Interested</span>
                                </button>
                            </div>
                        ) : (
                            <div className="post-footer">
                                <button
                                    type="button"
                                    className={`footer-action ${openCommentPosts[post.id] ? "active" : ""}`}
                                    onClick={() => toggleCommentComposer(post)}
                                >
                                    <FiMessageCircle />
                                    <span>{post.commentCount ?? post.comments?.length ?? 0}</span>
                                </button>
                            </div>
                        )}

                        {canOpenComments(post) && openCommentPosts[post.id] && (
                            <div className="comments-block">
                                {post.type === "post" && commentHasMore[post.id] && (
                                    <button
                                        type="button"
                                        className="inline-link-btn"
                                        onClick={() => loadMoreComments(post)}
                                        disabled={loadingMoreComments[post.id]}
                                        style={{ marginBottom: "10px" }}
                                    >
                                        {loadingMoreComments[post.id] ? "Loading comments..." : "Load older comments"}
                                    </button>
                                )}
                                {(post.comments || []).map((c) => {
                                    const commentId = c.id || `c-${Math.random()}`;
                                    return (
                                        <div className="comment-row" key={commentId}>
                                            <button
                                                type="button"
                                                ref={(el) => { commentAvatarRefs.current[commentId] = el; }}
                                                className={`comment-avatar profile-trigger ${c.author?.id ? "is-clickable" : ""}`}
                                                onClick={() => {
                                                    if (!c.author?.id) return;
                                                    openProfileMenu(commentId, `cavatar-${commentId}`);
                                                }}
                                                disabled={!c.author?.id}
                                                aria-label={`Open ${c.author?.name || "User"} profile`}
                                            >
                                                {c.author?.imageUrl ? (
                                                    <img src={c.author.imageUrl} alt={c.author?.name || "User"} className="profile-avatar-image" />
                                                ) : (
                                                    (c.author?.name || c.User?.name || "U")[0]?.toUpperCase()
                                                )}
                                            </button>
                                            <div className="comment-body">
                                                <div className="comment-meta">
                                                    <button
                                                        type="button"
                                                        ref={(el) => { commentAuthorRefs.current[commentId] = el; }}
                                                        className={`comment-author author-btn ${c.author?.id ? "is-clickable" : ""}`}
                                                        onClick={() => {
                                                            if (!c.author?.id) return;
                                                            openProfileMenu(commentId, `cauthor-${commentId}`);
                                                        }}
                                                        disabled={!c.author?.id}
                                                    >
                                                        {c.author?.name || c.User?.name || "User"}
                                                    </button>
                                                    {c.createdAt && (
                                                        <span>{new Date(c.createdAt).toLocaleString()}</span>
                                                    )}
                                                </div>
                                                <div className="comment-text">{c.comment}</div>
                                            </div>
                                        </div>
                                    );
                                })}

                                <div className="comment-box">
                                    <input
                                        value={commentDrafts[post.id] || ""}
                                        onChange={(e) =>
                                            setCommentDrafts((prev) => ({ ...prev, [post.id]: e.target.value }))
                                        }
                                        placeholder="Write a comment..."
                                    />
                                    <button onClick={() => addComment(post.id, commentDrafts[post.id] || "")}>
                                        Send
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                ))}
                {hasMorePosts && (
                    <button
                        type="button"
                        className="post-btn"
                        onClick={loadMorePosts}
                        disabled={loadingMorePosts}
                        style={{ width: "100%", marginTop: "12px" }}
                    >
                        <span>{loadingMorePosts ? "Loading..." : "Load More Posts"}</span>
                    </button>
                )}
            </div>

            {activeJob && (
                <div className="modal-overlay">
                    <div className="modal">
                        <h3>{activeJob.jobTitle}</h3>

                        <p>Submit your application for this position.</p>

                        <div className="modal-actions">
                            <button onClick={submitApplication}>Submit Application</button>

                            <button className="cancel" onClick={() => setActiveJob(null)}>
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {actionMessage && <p className="feed-message">{actionMessage}</p>}

            {editingPost && (
                <div className="modal-overlay">
                    <div className="modal post-edit-modal">
                        <h3>Edit Post</h3>
                        <textarea
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            rows={5}
                            className="edit-textarea"
                            placeholder="Update your post"
                        />
                        {editingPost.image && (
                            <div className="edit-preview">
                                <img src={editImagePreview || editingPost.image} alt="Current post" />
                            </div>
                        )}
                        <input
                            ref={editFileInputRef}
                            type="file"
                            accept="image/*"
                            className="hidden-file-input"
                            onChange={async (e) => {
                                const file = e.target.files?.[0] || null;
                                setEditImage(file);
                                if (file) {
                                    const preview = await fileToDataUrl(file);
                                    setEditImagePreview(preview);
                                } else {
                                    setEditImagePreview(editingPost?.image || "");
                                }
                            }}
                        />
                        <div className="modal-actions">
                            <button type="button" onClick={() => editFileInputRef.current?.click()}>
                                {editImage ? "Change Image" : "Replace Image"}
                            </button>
                            <button type="button" onClick={savePostEdit} disabled={editSaving}>
                                {editSaving ? "Saving..." : "Save"}
                            </button>
                            <button type="button" className="cancel" onClick={closeEditPost}>
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ProfileActionMenu - shown when clicking an avatar/author name */}
            {profileMenuPostId && profileMenuAnchor && (() => {
                // Find the post that triggered the menu
                const menuPost = posts.find((p) => p.id === profileMenuPostId);
                if (!menuPost) return null;

                // Determine which anchor ref to use
                let anchorEl = null;
                if (profileMenuAnchor.startsWith("avatar-")) {
                    anchorEl = avatarRefs.current[profileMenuPostId];
                } else if (profileMenuAnchor.startsWith("author-")) {
                    anchorEl = authorBtnRefs.current[profileMenuPostId];
                } else if (profileMenuAnchor.startsWith("cavatar-")) {
                    const commentId = profileMenuAnchor.replace("cavatar-", "");
                    anchorEl = commentAvatarRefs.current[commentId];
                } else if (profileMenuAnchor.startsWith("cauthor-")) {
                    const commentId = profileMenuAnchor.replace("cauthor-", "");
                    anchorEl = commentAuthorRefs.current[commentId];
                }

                if (!anchorEl) return null;

                const profile = getPostProfile(menuPost);
                if (!profile?.id) return null;

                return (
                    <ProfileActionMenu
                        anchorRef={{ current: anchorEl }}
                        profile={profile}
                        onViewProfile={handleViewProfile}
                        onMessage={handleMessage}
                        onClose={() => {
                            setProfileMenuPostId(null);
                            setProfileMenuAnchor(null);
                        }}
                    />
                );
            })()}

            {/* ProfilePreviewModal - shown when "View Profile" is clicked */}
            {profilePreviewUserId && (
                <ProfilePreviewModal
                    userId={profilePreviewUserId}
                    onClose={() => setProfilePreviewUserId(null)}
                />
            )}
        </>
    );
}

