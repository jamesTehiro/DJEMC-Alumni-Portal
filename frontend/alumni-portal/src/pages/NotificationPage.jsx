import React, { useEffect, useRef, useState } from "react";
import { Card, Button } from "react-bootstrap";
import { useNavigate } from "react-router-dom";
import { FiBell } from "react-icons/fi";
import { api } from "../services/api";
import useRenderDebug from "../hooks/useRenderDebug";
import useStrictSafeEffect from "../hooks/useStrictSafeEffect";
import InterviewDetailsModal from "../components/InterviewDetailsModal";
import "./NotificationPage.css";
import { useUndoDelete } from "../hooks/useUndoDelete";

export default function NotificationPage() {
    useRenderDebug("NotificationPage");
    const navigate = useNavigate();
    const [notifications, setNotifications] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [activeNotification, setActiveNotification] = useState(null);
    const [interviewDetailsLoading, setInterviewDetailsLoading] = useState(false);
    const [interviewDetailsError, setInterviewDetailsError] = useState("");
    const interviewDetailsRequest = useRef(0);
    const { scheduleDelete } = useUndoDelete();

    const loadNotifications = async () => {
        setError("");
        try {
            const data = await api.get("/notifications", true);
            setNotifications(Array.isArray(data) ? data : []);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useStrictSafeEffect(
        "NotificationPage:init",
        () => {
            loadNotifications();
            return undefined;
        },
        [],
        { label: "NotificationPage init" }
    );

    const markAsRead = async (id) => {
        try {
            await api.put(`/notifications/read/${id}`, {}, true);
            setNotifications((prev) =>
                prev.map((item) =>
                    item.id === id ? { ...item, isRead: true } : item
                )
            );
        } catch (err) {
            setError(err.message);
        }
    };

    const handleDeleteNotification = (item) => {
        const itemId = item.id;
        setNotifications((prev) => prev.filter((n) => n.id !== itemId));
        if (activeNotification?.id === itemId) {
            interviewDetailsRequest.current += 1;
            setInterviewDetailsLoading(false);
            setInterviewDetailsError("");
            setActiveNotification(null);
        }

        scheduleDelete({
            item,
            itemName: "Notification",
            message: "The notification was deleted.",
            deleteAction: () => api.delete(`/notifications/${itemId}`, true),
            restoreAction: () => {
                setNotifications((prev) => {
                    const exists = prev.find((n) => n.id === itemId);
                    if (exists) return prev;
                    return [...prev, item].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
                });
            },
        });
    };

    const unreadCount = notifications.filter((n) => !n.isRead).length;

    const isInterviewNotification = (item) => {
        const message = String(item?.message || "").toLowerCase();
        return item?.type === "interview" || !!item?.interview_id || message.includes("you are qualified for");
    };

    const handleOpen = async (item) => {
        if (!item.isRead) await markAsRead(item.id);
        if (item.type === "profile_update_request") {
            navigate("/profile");
            return;
        }
        if (!isInterviewNotification(item)) return;

        const requestId = ++interviewDetailsRequest.current;
        setActiveNotification(item);
        setInterviewDetailsLoading(true);
        setInterviewDetailsError("");
        try {
            const details = await api.get(`/notifications/${item.id}/interview`, true);
            if (requestId === interviewDetailsRequest.current) setActiveNotification(details);
        } catch (err) {
            if (requestId === interviewDetailsRequest.current) {
                setInterviewDetailsError(err.message || "Unable to load interview details.");
            }
        } finally {
            if (requestId === interviewDetailsRequest.current) setInterviewDetailsLoading(false);
        }
    };

    const closeInterviewDetails = () => {
        interviewDetailsRequest.current += 1;
        setActiveNotification(null);
        setInterviewDetailsLoading(false);
        setInterviewDetailsError("");
    };

    return (
        <div className="notification-page">
            <div className="notification-head">
                <div className="bell-wrapper">
                    <div className="bell-icon">
                        <FiBell />
                        {unreadCount > 0 && <span className="badge-dot">{unreadCount}</span>}
                    </div>
                    <div>
                        <h2>Notifications</h2>
                        <p>
                            In-app fallback for important updates. Email notifications are still sent.
                        </p>
                    </div>
                </div>
                {unreadCount > 0 && (
                    <Button size="sm" variant="outline-success" onClick={() => notifications.forEach((n) => !n.isRead && markAsRead(n.id))}>
                        Mark all as read
                    </Button>
                )}
            </div>

            {loading && <p>Loading notifications...</p>}
            {error && <p className="notification-error">{error}</p>}

            {!loading && notifications.length === 0 && (
                <Card className="notification-empty">
                    <Card.Body>No notifications yet.</Card.Body>
                </Card>
            )}

            <div className="notification-list">
                {notifications.map((item) => (
                    <Card
                        key={item.id}
                        className={`notification-card clickable ${item.isRead ? "read" : "unread"}`}
                        onClick={() => handleOpen(item)}
                    >
                        <Card.Body>
                            <div className="notification-top">
                                <div className="notification-meta">
                                    <span className="notification-state">
                                        {item.isRead ? "Read" : "Unread"}
                                    </span>
                                    <span className="notification-time">
                                        {new Date(item.createdAt).toLocaleString()}
                                    </span>
                                </div>
                                <Button
                                    size="sm"
                                    variant="outline-danger"
                                    className="notification-delete-btn"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleDeleteNotification(item);
                                    }}
                                >
                                    Delete
                                </Button>
                            </div>
                            <p className="notification-message">{item.message}</p>
                            {item.type === "profile_update_request" && (
                                <Button
                                    size="sm"
                                    variant="success"
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        handleOpen(item);
                                    }}
                                >
                                    Update Profile
                                </Button>
                            )}
                            {!item.isRead && (
                                <Button
                                    size="sm"
                                    variant="outline-success"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        markAsRead(item.id);
                                    }}
                                >
                                    Mark as Read
                                </Button>
                            )}
                        </Card.Body>
                    </Card>
                ))}
            </div>

            <InterviewDetailsModal
                show={!!activeNotification}
                onHide={closeInterviewDetails}
                notification={activeNotification}
                notificationLoading={interviewDetailsLoading}
                notificationError={interviewDetailsError}
                onNotificationRetry={activeNotification ? () => handleOpen(activeNotification) : undefined}
            />
        </div>
    );
}

