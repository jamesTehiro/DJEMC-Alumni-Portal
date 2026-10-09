import { useEffect, useMemo, useState } from "react";
import { api } from "../../services/api";
import useStrictSafeEffect from "../../hooks/useStrictSafeEffect";

export default function useRegistrarAdminData() {
    const [pendingUsers, setPendingUsers] = useState([]);
    const [records, setRecords] = useState([]);
    const [searchTerm, setSearchTerm] = useState("");
    const [searchResults, setSearchResults] = useState([]);
    const [selectedUser, setSelectedUser] = useState(null);
    const [selectedRecord, setSelectedRecord] = useState(null);
    const [message, setMessage] = useState("");
    const [error, setError] = useState("");
    const [showAddModal, setShowAddModal] = useState(false);
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [savingRecord, setSavingRecord] = useState(false);

    const user = useMemo(() => {
        try {
            return JSON.parse(localStorage.getItem("user") || "null");
        } catch {
            return null;
        }
    }, []);

    const courseCounts = useMemo(() => {
        const filtered = records.filter((r) => r?.course && String(r.course).trim() !== "");
        const counts = {};
        filtered.forEach((r) => {
            const course = String(r.course).trim();
            counts[course] = (counts[course] || 0) + 1;
        });
        return Object.entries(counts)
            .map(([course, count]) => ({ course, count }))
            .sort((a, b) => a.course.localeCompare(b.course));
    }, [records]);

    const isAllowed = user?.role === "admin" && user?.admin_scope === "registrar";

    const loadPendingUsers = async () => {
        const data = await api.get("/users/pending", true);
        setPendingUsers(Array.isArray(data) ? data : []);
    };

    const loadRecords = async () => {
        const data = await api.get("/alumni-records", true);
        const items = Array.isArray(data) ? data : [];
        console.log("[HOOK_LOAD_RECORDS]", items.length, "records", items.slice(0, 2));
        setRecords(items);
    };

    useStrictSafeEffect(
        "RegistrarAdminData:init",
        () => {
            if (!isAllowed) return undefined;
            Promise.all([loadPendingUsers(), loadRecords()]).catch((err) => setError(err.message));
            return undefined;
        },
        [isAllowed],
        { label: "Registrar admin init" }
    );

    useEffect(() => {
        if (!isAllowed) return;
        if (isAddModalOpen) return;
        const timer = setTimeout(async () => {
            const value = searchTerm.trim();
            if (!value) {
                setSearchResults([]);
                setSelectedRecord(null);
                return;
            }
            try {
                const data = await api.get(`/alumni-records/search?name=${encodeURIComponent(value)}`, true);
                const results = Array.isArray(data) ? data : [];
                setSearchResults(results);
                const exactMatch =
                    results.find((item) => item.full_name.toLowerCase() === value.toLowerCase()) ||
                    results[0] ||
                    null;
                setSelectedRecord(exactMatch);
            } catch (err) {
                setError(err.message);
            }
        }, 300);

        return () => clearTimeout(timer);
    }, [searchTerm, isAllowed, isAddModalOpen]);

    useEffect(() => {
        if (!selectedUser) return;
        setSearchTerm(selectedUser.name || "");
    }, [selectedUser]);

    const clearNotices = () => {
        setMessage("");
        setError("");
    };

    const handleApprove = async () => {
        if (!selectedUser?.id || !selectedRecord) return;
        clearNotices();
        try {
            await api.put(
                `/users/${selectedUser.id}/approve`,
                {
                    alumni_record_id: selectedRecord.id,
                    course: selectedRecord.course,
                    batch_year: selectedRecord.batch_year,
                    full_name: selectedRecord.full_name
                },
                true
            );
            setMessage(`Approved ${selectedUser.name}.`);
            await loadPendingUsers();
            setSelectedUser(null);
        } catch (err) {
            setError(err.message);
        }
    };

    const handleReject = async (userId) => {
        clearNotices();
        try {
            await api.put(`/users/${userId}/reject`, {}, true);
            setMessage("User rejected.");
            await loadPendingUsers();
            if (selectedUser?.id === userId) setSelectedUser(null);
        } catch (err) {
            setError(err.message);
        }
    };

    const handleSaveRecord = async (form) => {
        setSavingRecord(true);
        clearNotices();
        try {
            const created = await api.post("/alumni-records", form, true);
            setMessage("Alumni record added.");
            setShowAddModal(false);
            setIsAddModalOpen(false);
            await loadRecords();
            setSelectedRecord(created);
            setSearchTerm(created.full_name || "");
        } catch (err) {
            setError(err.message);
        } finally {
            setSavingRecord(false);
        }
    };

    const handleSearchChange = (value) => {
        if (isAddModalOpen) return;
        setSearchTerm(value);
    };

    const closeAddModal = () => {
        setShowAddModal(false);
        setIsAddModalOpen(false);
    };

    const openAddModal = () => {
        setShowAddModal(true);
        setIsAddModalOpen(true);
    };

    const statusVariant = (status) => {
        if (status === "verified") return "success";
        if (status === "rejected") return "danger";
        return "warning";
    };

    return {
        user,
        isAllowed,
        pendingUsers,
        records,
        setRecords,
        searchTerm,
        searchResults,
        selectedUser,
        selectedRecord,
        setSelectedRecord,
        message,
        error,
        showAddModal,
        savingRecord,
        setSelectedUser,
        handleApprove,
        handleReject,
        handleSaveRecord,
        handleSearchChange,
        openAddModal,
        closeAddModal,
        statusVariant,
        courseCounts
    };
}
