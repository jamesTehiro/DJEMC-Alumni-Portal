import { academicInfo, academicLabel } from "../utils/academicPrograms";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Modal } from "react-bootstrap";
import { FiMessageCircle, FiSend } from "react-icons/fi";
import { api } from "../services/api";
import useRenderDebug from "../hooks/useRenderDebug";
import useStrictSafeEffect from "../hooks/useStrictSafeEffect";
import { useUndoDelete } from "../hooks/useUndoDelete";
import AdminShell from "../components/AdminShell";
import "./AdminEmployerPage.css";
import "./FeedPage.css";
import "./AdminAlumniPage.css";

export default function AdminAlumniPage() {
    useRenderDebug("AdminAlumniPage");
    const navigate = useNavigate();

    const [posts, setPosts] = useState([]);
    const [users, setUsers] = useState([]);

    const [announcement, setAnnouncement] = useState({
        title: "",
        content: "",
        targetYear: "",
        day: "",
        time: "",
        location: ""
    });

    const [message, setMessage] = useState("");
    const [error, setError] = useState("");

    const [loadingMorePosts, setLoadingMorePosts] = useState(false);
    const [commentDrafts, setCommentDrafts] = useState({});
    const [openCommentPosts, setOpenCommentPosts] = useState({});
    const [commentCursors, setCommentCursors] = useState({});
    const [commentHasMore, setCommentHasMore] = useState({});
    const [loadingMoreComments, setLoadingMoreComments] = useState({});

    const [selectedProfile, setSelectedProfile] = useState(null);

    const [postMenuOpenId, setPostMenuOpenId] = useState(null);
    const postMenuRef = useRef(null);

    const [postsCursor, setPostsCursor] = useState(null);
    const [hasMorePosts, setHasMorePosts] = useState(false);
    const { scheduleDelete } = useUndoDelete();

    const [dashboardPanel, setDashboardPanel] = useState("recentActivity");

    // Panel controls for Total Alumni
    const [totalQuery, setTotalQuery] = useState("");
    const [totalPage, setTotalPage] = useState(1);
    const [totalActivities, setTotalActivities] = useState(0);

    // Panel controls for Active Alumni
    const [activeQuery, setActiveQuery] = useState("");
    const [activePage, setActivePage] = useState(1);

    // Page sizes for pagination
    const totalPageSize = 10;
    const activePageSize = 10;

    const user = useMemo(() => {
        try {
            return JSON.parse(localStorage.getItem("user") || "null");
        } catch {
            return null;
        }
    }, []);

    const isAllowed = user?.role === "admin" && (user?.admin_scope || "alumni") === "alumni";

    const getDetailedRoleLabel = (role, adminScope = "") => {
        if (role === "admin" && adminScope) {
            const normalized = String(adminScope).trim().toLowerCase();
            if (normalized === "employer") return "Admin Â· Employer";
            if (normalized === "alumni") return "Admin Â· Alumni";
            return `Admin Â· ${adminScope}`;
        }
        if (role === "admin") return "Admin";
        if (role === "employer") return "Employer";
        if (role === "alumni") return "Alumni";
        return "User";
    };

    const getProfileImage = (userProfile) => {
        if (!userProfile) return "";
        if (userProfile.role === "admin" || userProfile.admin_scope) {
            return userProfile.admin_avatar_url || "";
        }
        return userProfile?.AlumniProfile?.avatar_url || userProfile?.EmployerProfile?.logo_url || "";
    };

    const getAuthorProfile = (author, fallbackRole = "alumni") => ({
        id: author?.id || null,
        name: author?.name || (fallbackRole === "admin" ? "DJEMC Admin" : fallbackRole === "employer" ? "Employer" : "Alumni"),
        role: author?.role || fallbackRole,
        adminScope: author?.admin_scope || "",
        imageUrl: getProfileImage(author),
        label: getDetailedRoleLabel(author?.role || fallbackRole, author?.admin_scope)
    });

    const openProfile = (profile) => {
        if (!profile?.id) return;
        setSelectedProfile(profile);
    };

    const formatDate = (value) => {
        if (!value) return "";
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return "";
        return date.toLocaleDateString("en-US");
    };

    const badgeLabel = (role, adminScope = "") => {
        if (role === "admin" || adminScope) return "Admin";
        if (role === "employer") return "Employer";
        return "Alumni";
    };

    const adminScopeLabel = (role, adminScope = "") => {
        if (role !== "admin" || !adminScope) return "";
        const normalized = String(adminScope).trim().toLowerCase();
        if (normalized === "employer") return "Admin Â· Employer";
        if (normalized === "alumni") return "Admin Â· Alumni";
        return `Admin Â· ${adminScope}`;
    };

    const feedPosts = useMemo(() => {
        return posts
            .slice()
            .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    }, [posts]);

    const mapPostItem = (item) => ({
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
            items: items.map(mapPostItem),
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

    const loadUsers = async () => {
        try {
            const data = await api.get("/admin/alumni/users", true);
            setUsers(Array.isArray(data) ? data : []);
        } catch (err) {
            setError(err.message);
        }
    };

    const loadFeed = async () => {
        try {
            const [postResult, announcementResult, applicationsResult] = await Promise.allSettled([
                fetchPostPage(),
                api.get("/announcements"),
                api.get("/applications")
            ]);

            const postItems = postResult.status === "fulfilled"
                ? postResult.value
                : { items: [], nextCursor: null, hasMore: false };
            const announcementItems = announcementResult.status === "fulfilled" ? announcementResult.value : [];

            if (postResult.status === "rejected") {
                console.warn("Failed to load alumni posts:", postResult.reason);
            }
            if (announcementResult.status === "rejected") {
                console.warn("Failed to load announcements:", announcementResult.reason);
            }

            const postFeed = Array.isArray(postItems.items) ? postItems.items : [];

            const announcementFeed = (Array.isArray(announcementItems) ? announcementItems : []).map((item) => ({
                id: `announcement-${item.id}`,
                sourceId: item.id,
                type: "announcement",
                author: item.admin?.name || "DJEMC Admin",
                role: item.admin?.role || "admin",
                adminScope: item.admin?.admin_scope || "",
                authorId: item.admin?.id || null,
                authorImage: getProfileImage(item.admin),
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

            setPosts([...postFeed, ...announcementFeed]);
            setPostsCursor(postItems.nextCursor);
            setHasMorePosts(postItems.hasMore);

            // Applications count (best-effort). Some APIs may return paginated objects; handle arrays and objects.
            let appsCount = 0;
            if (applicationsResult && applicationsResult.status === "fulfilled") {
                const apps = applicationsResult.value;
                if (Array.isArray(apps)) appsCount = apps.length;
                else if (Array.isArray(apps?.items)) appsCount = apps.items.length;
            }

            // Compute total activities: posts + comments + likes + applications + profile updates + login events (profile/login events may be unavailable client-side)
            const postCount = postFeed.filter((p) => p.type === "post").length;
            const commentCount = postFeed.reduce((acc, cur) => acc + (Number(cur.commentCount || 0)), 0);
            const likesCount = postFeed.reduce((acc, cur) => acc + (Number(cur.likes || 0)), 0);
            const profileUpdates = 0; // requires backend logs
            const loginEvents = 0; // requires backend logs
            setTotalActivities(postCount + commentCount + likesCount + appsCount + profileUpdates + loginEvents);
        } catch (err) {
            setError(err.message);
        }
    };

    // Helpers for Total / Active alumni panels
    const getUserName = (user) => user?.full_name || user?.name || user?.email || "Unknown";
    const getUserCourse = (user) => { const info = academicInfo(user); return academicLabel(info.course, info.major); };
    const getUserYear = (user) => academicInfo(user).year || "N/A";
    const getUserAddress = (user) => user?.AlumniProfile?.address || "N/A";
    const getUserEmployment = (user) => user?.AlumniProfile?.latestEmployment || "Unemployed";

    const renderTotalAlumniPanel = () => {
        const verified = users.filter((u) => u.account_status === "verified");
        const q = totalQuery.trim().toLowerCase();
        const filtered = q
            ? verified.filter((u) => (getUserName(u) || "").toLowerCase().includes(q) || (getUserCourse(u) || "").toLowerCase().includes(q) || String(getUserYear(u)).includes(q))
            : verified;

        const pageCount = Math.max(1, Math.ceil(filtered.length / totalPageSize));
        const start = (totalPage - 1) * totalPageSize;
        const pageItems = filtered.slice(start, start + totalPageSize);

        return (
            <div>
                <div style={{ display: "flex", gap: 12, marginBottom: 12, alignItems: "center" }}>
                    <input placeholder="Search name, program, major, year" value={totalQuery} onChange={(e) => { setTotalQuery(e.target.value); setTotalPage(1); }} />
                </div>

                <div className="queue-table">
                    <div className="queue-row header">
                        <span>Name</span>
                        <span>Program / Major</span>
                        <span>Graduation Year</span>
                    </div>
                    {pageItems.length === 0 ? (
                        <div className="queue-row"><span>No alumni found.</span><span></span><span></span></div>
                    ) : (
                        pageItems.map((u) => (
                            <div className="queue-row" key={u.id || `${u.email}-${u.account_status}`}>
                                <span>{getUserName(u)}</span>
                                <span>{getUserCourse(u)}</span>
                                <span>{getUserYear(u)}</span>
                            </div>
                        ))
                    )}
                </div>

                <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center" }}>
                    <button onClick={() => setTotalPage(Math.max(1, totalPage - 1))} disabled={totalPage <= 1}>Prev</button>
                    <span>{totalPage} / {pageCount}</span>
                    <button onClick={() => setTotalPage(Math.min(pageCount, totalPage + 1))} disabled={totalPage >= pageCount}>Next</button>
                </div>
            </div>
        );
    };

    const renderActiveAlumniPanel = () => {
        // Determine activity from posts/comments in the last 30 days plus recent user updatedAt
        const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
        const activeUserIds = new Set();
        posts.forEach((p) => {
            if (p.createdAt && new Date(p.createdAt).getTime() >= cutoff && p.authorId) activeUserIds.add(p.authorId);
            (p.comments || []).forEach((c) => {
                if (c.createdAt && new Date(c.createdAt).getTime() >= cutoff && c.author?.id) activeUserIds.add(c.author.id);
            });
        });

        const candidates = users.filter((u) => u.account_status === "verified");
        const enriched = candidates.map((u) => ({
            ...u,
            isActive: activeUserIds.has(u.id) || (u.updatedAt && new Date(u.updatedAt).getTime() >= cutoff)
        }));

        const q = activeQuery.trim().toLowerCase();
        const filtered = q
            ? enriched.filter((u) =>
                (getUserName(u) || "").toLowerCase().includes(q) ||
                (getUserCourse(u) || "").toLowerCase().includes(q) ||
                (getUserAddress(u) || "").toLowerCase().includes(q) ||
                (getUserEmployment(u) || "").toLowerCase().includes(q)
            )
            : enriched;

        const pageCount = Math.max(1, Math.ceil(filtered.length / activePageSize));
        const start = (activePage - 1) * activePageSize;
        const pageItems = filtered.slice(start, start + activePageSize);

        return (
            <div>
                <div style={{ display: "flex", gap: 12, marginBottom: 12, alignItems: "center" }}>
                    <input placeholder="Search name, program, major, address or employment" value={activeQuery} onChange={(e) => { setActiveQuery(e.target.value); setActivePage(1); }} />
                </div>

                <div className="queue-table">
                    <div className="queue-row header">
                        <span>Name</span>
                        <span>Program / Major</span>
                        <span>Address</span>
                        <span>Employment</span>
                        <span>Status</span>
                    </div>
                    {pageItems.length === 0 ? (
                        <div className="queue-row"><span>No active alumni found.</span><span></span><span></span><span></span><span></span></div>
                    ) : (
                        pageItems.map((u) => (
                            <div className="queue-row" key={u.id || `${u.email}-${u.account_status}`}>
                                <span title={getUserName(u)} style={{ textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>{getUserName(u)}</span>
                                <span title={getUserCourse(u)} style={{ overflowWrap: "anywhere" }}>{getUserCourse(u)}</span>
                                <span title={getUserAddress(u)} style={{ textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>{getUserAddress(u)}</span>
                                <span title={getUserEmployment(u)} style={{ textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>{getUserEmployment(u)}</span>
                                <span>{u.isActive ? "Active" : "Inactive"}</span>
                            </div>
                        ))
                    )}
                </div>

                <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center" }}>
                    <button onClick={() => setActivePage(Math.max(1, activePage - 1))} disabled={activePage <= 1}>Prev</button>
                    <span>{activePage} / {pageCount}</span>
                    <button onClick={() => setActivePage(Math.min(pageCount, activePage + 1))} disabled={activePage >= pageCount}>Next</button>
                </div>
            </div>
        );
    };

    useStrictSafeEffect(
        `AdminAlumniPage:init:${isAllowed}`,
        () => {
            if (!isAllowed) return undefined;
            loadUsers();
            loadFeed();
            return undefined;
        },
        [isAllowed],
        { label: "AdminAlumniPage init" }
    );

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

    const submitAnnouncement = async (e) => {
        e.preventDefault();
        setMessage("");
        setError("");
        try {
            await api.post("/admin/alumni/announcements", {
                title: announcement.title,
                content: announcement.content,
                target_year: announcement.targetYear || undefined,
                day: announcement.day || undefined,
                time: announcement.time || undefined,
                location: announcement.location || undefined
            }, true);
            setMessage(
                announcement.targetYear
                    ? `Announcement posted to class of ${announcement.targetYear}.`
                    : "Announcement posted to all verified alumni."
            );
            setAnnouncement({
                title: "",
                content: "",
                targetYear: "",
                day: "",
                time: "",
                location: ""
            });
            loadFeed();
        } catch (err) {
            setError(err.message);
        }
    };

    const removeFeedItem = async (item) => {
        const restore = () => {
            setPosts((prev) => {
                if (prev.some((entry) => entry.id === item.id)) return prev;
                return [item, ...prev];
            });
            setPostMenuOpenId(null);
        };
        const remove = async () => {
            try {
                if (item.type === "announcement") {
                    await api.delete(`/admin/alumni/announcements/${item.sourceId}`, true);
                } else {
                    await api.delete(`/posts/${item.sourceId}`, true);
                }
                setMessage("Post deleted.");
            } catch (err) {
                setError(err.message);
                restore();
            }
        };
        setPosts((prev) => prev.filter((entry) => entry.id !== item.id));
        setPostMenuOpenId(null);
        const id = await scheduleDelete(item.id, remove, restore);
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
                                comments: [...(p.comments || []), { comment: text, User: user, author: getAuthorProfile(user, "alumni") }],
                                commentCount: (p.commentCount || 0) + 1
                            }
                            : p
                    )
                );
            }
            setCommentDrafts((prev) => ({ ...prev, [postId]: "" }));
        } catch (err) {
            setMessage(err.message);
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
        const isPost = post?.type === "post" && (post?.role === "alumni" || (post?.role === "admin" && post?.adminScope === "alumni"));
        const isAnnouncementFromAdmin = post?.type === "announcement" && post?.role === "admin";
        return isPost || isAnnouncementFromAdmin;
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
                setMessage(err.message);
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
            setMessage(err.message);
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
            setMessage(err.message);
        } finally {
            setLoadingMorePosts(false);
        }
    };

    const pendingCount = users.filter((u) => u.account_status === "pending").length;
    const totalPosts = feedPosts.length;
    const announcementCount = feedPosts.filter((item) => item.type === "announcement").length;

    const handleLogout = () => {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        navigate("/");
    };

    if (!isAllowed) {
        return (
            <div className="admin-employer-shell">
                <div className="admin-employer-center">
                    <div className="admin-employer-card">
                        <h3>Alumni Admin Access Only</h3>
                        <p>Please log in using an Alumni Admin account.</p>
                        <Link to="/admin/login">Go to Login</Link>
                    </div>
                </div>
            </div>
        );
    }

    const showDeleteMenu = (post) => post.type === "post" || post.type === "announcement";

    const panelTitle =
        dashboardPanel === "allPosts" ? "All Posts"
            : dashboardPanel === "announcements" ? "Announcements"
                : dashboardPanel === "postAnnouncement" ? "Create Announcement"
                    : dashboardPanel === "totalAlumni" ? "Total Alumni"
                        : dashboardPanel === "activeAlumni" ? "Active Alumni"
                            : "Recent Activity";

    const renderPanelContent = () => {
        if (dashboardPanel === "postAnnouncement") {
            return (
                <form className="admin-feed-form" onSubmit={submitAnnouncement}>
                    <label>
                        <span>Title</span>
                        <input
                            value={announcement.title}
                            onChange={(e) => setAnnouncement((prev) => ({ ...prev, title: e.target.value }))}
                            required
                        />
                    </label>
                    <label>
                        <span>Content</span>
                        <textarea
                            rows={4}
                            value={announcement.content}
                            onChange={(e) => setAnnouncement((prev) => ({ ...prev, content: e.target.value }))}
                            required
                        />
                    </label>
                    <label>
                        <span>Target Graduation Year</span>
                        <input
                            value={announcement.targetYear}
                            onChange={(e) => setAnnouncement((prev) => ({ ...prev, targetYear: e.target.value }))}
                            placeholder="Optional"
                        />
                    </label>
                    <label>
                        <span>Day</span>
                        <input
                            type="date"
                            value={announcement.day}
                            onChange={(e) => setAnnouncement((prev) => ({ ...prev, day: e.target.value }))}
                        />
                    </label>
                    <label>
                        <span>Time</span>
                        <input
                            type="time"
                            value={announcement.time}
                            onChange={(e) => setAnnouncement((prev) => ({ ...prev, time: e.target.value }))}
                        />
                    </label>
                    <label>
                        <span>Location</span>
                        <input
                            value={announcement.location}
                            onChange={(e) => setAnnouncement((prev) => ({ ...prev, location: e.target.value }))}
                            placeholder="Optional"
                        />
                    </label>
                    <button type="submit" className="admin-feed-submit">
                        <FiSend />
                        <span>Publish</span>
                    </button>
                </form>
            );
        }

        const filteredPosts = dashboardPanel === "announcements"
            ? feedPosts.filter((item) => item.type === "announcement")
            : feedPosts;

        if (dashboardPanel === "totalAlumni") return renderTotalAlumniPanel();
        if (dashboardPanel === "activeAlumni") return renderActiveAlumniPanel();

        return (
            <>
                <div className="admin-feed-list">
                    {filteredPosts.length === 0 && <p className="empty-jobs">No items available.</p>}

                    {filteredPosts.map((post) => (
                        <article key={post.id} className={`post-card ${post.role} admin-feed-card`}>
                            <div className="post-header">
                                <button
                                    type="button"
                                    className={`avatar dark profile-trigger ${post.authorId ? "is-clickable" : ""}`}
                                    onClick={() => openProfile({
                                        id: post.authorId,
                                        name: post.author,
                                        role: post.role,
                                        adminScope: post.adminScope,
                                        imageUrl: post.authorImage
                                    })}
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
                                            className={`author author-btn ${post.authorId ? "is-clickable" : ""}`}
                                            onClick={() => openProfile({
                                                id: post.authorId,
                                                name: post.author,
                                                role: post.role,
                                                adminScope: post.adminScope,
                                                imageUrl: post.authorImage
                                            })}
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

                                {showDeleteMenu(post) && (
                                    <div className="post-actions" ref={postMenuOpenId === post.id ? postMenuRef : null}>
                                        <button
                                            type="button"
                                            className="post-actions-trigger"
                                            onClick={() => setPostMenuOpenId((prev) => (prev === post.id ? null : post.id))}
                                            aria-label="Post actions"
                                        >
                                            ...
                                        </button>
                                        {postMenuOpenId === post.id && (
                                            <div className="post-actions-menu">
                                                <button type="button" className="danger" onClick={() => removeFeedItem(post)}>
                                                    Delete
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            <p className="post-text">{post.text}</p>

                            {post.image && <img src={post.image} alt="post" className="post-image" />}

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
                                    {(post.comments || []).map((c) => (
                                        <div className="comment-row" key={c.id || Math.random()}>
                                            <button
                                                type="button"
                                                className={`comment-avatar profile-trigger ${c.author?.id ? "is-clickable" : ""}`}
                                                onClick={() => openProfile(c.author)}
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
                                                        className={`comment-author author-btn ${c.author?.id ? "is-clickable" : ""}`}
                                                        onClick={() => openProfile(c.author)}
                                                        disabled={!c.author?.id}
                                                    >
                                                        {c.author?.name || c.User?.name || "User"}
                                                    </button>
                                                    {c.createdAt && <span>{new Date(c.createdAt).toLocaleString()}</span>}
                                                </div>
                                                <div className="comment-text">{c.comment}</div>
                                            </div>
                                        </div>
                                    ))}

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
                        </article>
                    ))}
                    {hasMorePosts && dashboardPanel !== "announcements" && (
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
            </>
        );
    };

    return (
        <AdminShell
            scope="alumni"
            title="Alumni Coordinator"
            subtitle="Monitor alumni activity, posts, and announcements at a glance."
            onLogout={handleLogout}
        >
            <div className="admin-main-content">
                {message && <p className="notice success">{message}</p>}
                {error && <p className="notice error">{error}</p>}

                <section className="metric-grid alumni-metric-grid mobile-scroll-cards">

                    <button
                        type="button"
                        className={`metric-card metric-overview-card metric-card-verified${dashboardPanel === "activeAlumni" ? " active" : ""}`}
                        onClick={() => setDashboardPanel("activeAlumni")}
                    >
                        <div className="metric-icon blue">V</div>
                        <div>
                            <p className="metric-label">Active Alumni</p>
                            <h3>{users.filter((u) => u.account_status === "verified").length}</h3>
                            <span>Verified Records</span>
                        </div>
                    </button>

                    <button
                        type="button"
                        className={`metric-card metric-overview-card metric-card-pending${dashboardPanel === "announcements" ? " active" : ""}`}
                        onClick={() => setDashboardPanel("announcements")}
                    >
                        <div className="metric-icon amber">A</div>
                        <div>
                            <p className="metric-label">Announcement</p>
                            <h3>{announcementCount}</h3>
                            <span>All Announcement</span>
                        </div>
                    </button>

                    <button
                        type="button"
                        className={`metric-card metric-overview-card metric-card-posts${dashboardPanel === "recentActivity" ? " active" : ""}`}
                        onClick={() => setDashboardPanel("recentActivity")}
                    >
                        <div className="metric-icon bronze">N</div>
                        <div>
                            <p className="metric-label">Recent Activity</p>
                            <h3>{totalActivities || totalPosts}</h3>
                            <span>{announcementCount} Announcements</span>
                        </div>
                    </button>
                </section>
                <section className="content-grid overview-content-grid">
                    <div className="queue-panel overview-queue-panel">
                        <div className="panel-header">
                            <h2>{panelTitle}</h2>
                            <span>Live feed</span>
                        </div>

                        {renderPanelContent()}
                    </div>
                </section>

                <Modal
                    show={!!selectedProfile}
                    onHide={() => setSelectedProfile(null)}
                    centered
                    dialogClassName="feed-profile-modal"
                    contentClassName="feed-profile-modal-content"
                >
                    <Modal.Header closeButton className="feed-profile-modal-header">
                        <Modal.Title>Profile Preview</Modal.Title>
                    </Modal.Header>
                    <Modal.Body className="feed-profile-modal-body">
                        <div className="feed-profile-preview">
                            <div className={`feed-profile-avatar ${selectedProfile?.imageUrl ? "has-photo" : ""}`}>
                                {selectedProfile?.imageUrl ? (
                                    <img src={selectedProfile.imageUrl} alt={selectedProfile?.name || "Profile"} />
                                ) : (
                                    (selectedProfile?.name || "U")[0]?.toUpperCase()
                                )}
                            </div>
                            <h4>{selectedProfile?.name || "N/A"}</h4>
                            <p>{selectedProfile?.label || getDetailedRoleLabel(selectedProfile?.role, selectedProfile?.adminScope)}</p>
                        </div>
                    </Modal.Body>
                </Modal>

            </div>
        </AdminShell>

    );
}






