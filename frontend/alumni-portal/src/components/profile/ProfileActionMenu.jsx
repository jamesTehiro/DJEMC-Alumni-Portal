import React, { useEffect, useRef, useCallback } from "react";
import { FiUser, FiMessageSquare } from "react-icons/fi";
import "./ProfileActionMenu.css";

/**
 * ProfileActionMenu - A small floating action modal anchored beside an avatar.
 *
 * Props:
 *   anchorRef  - React ref of the button element to anchor beside
 *   profile    - { id, name, role, adminScope, imageUrl }
 *   onViewProfile - callback when "View Profile" is clicked
 *   onMessage     - callback when "Message" is clicked
 *   onClose       - callback to close the menu
 */
export default function ProfileActionMenu({ anchorRef, profile, onViewProfile, onMessage, onClose }) {
    const menuRef = useRef(null);

    const handleKeyDown = useCallback((e) => {
        if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
        }
    }, [onClose]);

    useEffect(() => {
        const handleClickOutside = (e) => {
            if (menuRef.current && !menuRef.current.contains(e.target)) {
                // Don't close if clicking the anchor button itself
                if (anchorRef?.current && anchorRef.current.contains(e.target)) {
                    return;
                }
                onClose();
            }
        };

        document.addEventListener("mousedown", handleClickOutside);
        document.addEventListener("keydown", handleKeyDown);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
            document.removeEventListener("keydown", handleKeyDown);
        };
    }, [anchorRef, onClose, handleKeyDown]);

    // Position the menu relative to the anchor
    useEffect(() => {
        if (!anchorRef?.current || !menuRef.current) return;
        const anchorRect = anchorRef.current.getBoundingClientRect();
        const menu = menuRef.current;

        // Position below and to the right of the anchor
        let top = anchorRect.bottom + 4;
        let left = anchorRect.left;

        // Ensure menu stays within viewport
        const menuWidth = menu.offsetWidth || 180;
        const menuHeight = menu.offsetHeight || 100;
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        if (left + menuWidth > viewportWidth - 8) {
            left = viewportWidth - menuWidth - 8;
        }
        if (top + menuHeight > viewportHeight - 8) {
            top = anchorRect.top - menuHeight - 4;
        }
        if (left < 8) left = 8;
        if (top < 8) top = 8;

        menu.style.top = `${top}px`;
        menu.style.left = `${left}px`;
    }, [anchorRef]);

    const handleViewProfile = () => {
        onViewProfile(profile);
        onClose();
    };

    const handleMessage = () => {
        onMessage(profile);
        onClose();
    };

    return (
        <>
            <div className="profile-action-menu-overlay" />
            <div
                ref={menuRef}
                className="profile-action-menu"
                role="menu"
                aria-label="Profile actions"
            >
                <button
                    type="button"
                    className="profile-action-menu-item"
                    onClick={handleViewProfile}
                    role="menuitem"
                    aria-label="View Profile"
                >
                    <FiUser />
                    <span>View Profile</span>
                </button>
                <div className="profile-action-menu-divider" />
                <button
                    type="button"
                    className="profile-action-menu-item"
                    onClick={handleMessage}
                    role="menuitem"
                    aria-label="Message"
                >
                    <FiMessageSquare />
                    <span>Message</span>
                </button>
            </div>
        </>
    );
}