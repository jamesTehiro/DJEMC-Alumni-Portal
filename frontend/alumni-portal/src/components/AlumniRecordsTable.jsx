import { academicLabel, programLabel, programKey } from "../utils/academicPrograms";
import React, { useMemo, useState } from "react";
import DeleteConfirmationModal from "./DeleteConfirmationModal";

export default function AlumniRecordsTable({
    records,
    selectedRecordId,
    onDeleteRecord,
    deletingRecordId
}) {
    const [showMasterList, setShowMasterList] = useState(true);
    const [expandedCourse, setExpandedCourse] = useState("");
    const [expandedBatch, setExpandedBatch] = useState("");
    const [deleteTarget, setDeleteTarget] = useState(null);

    const groupedRecords = useMemo(() => {
        return records.reduce((acc, record) => {
            const courseKey = programKey(record.course) || "Unassigned";
            const batchKey = String(record.batch_year || "Unknown");
            acc[courseKey] = acc[courseKey] || {};
            acc[courseKey][batchKey] = acc[courseKey][batchKey] || [];
            acc[courseKey][batchKey].push(record);
            return acc;
        }, {});
    }, [records]);

    const courses = Object.keys(groupedRecords).sort();

    const handleDeleteClick = (e, record) => {
        e.stopPropagation();
        setDeleteTarget(record);
    };

    const handleDeleteConfirm = () => {
        if (deleteTarget && onDeleteRecord) {
            onDeleteRecord(deleteTarget);
        }
        setDeleteTarget(null);
    };

    const isDeleting = (id) => deletingRecordId === id;

    return (
        <div className="records-group-list">
            {courses.length === 0 && <p className="empty mb-0">No alumni records yet.</p>}
            <button
                type="button"
                className={`records-master-toggle${showMasterList ? " open" : ""}`}
                onClick={() => {
                    setShowMasterList((prev) => !prev);
                    setExpandedCourse("");
                    setExpandedBatch("");
                }}
            >
                Master Alumni List
            </button>

            {showMasterList && courses.map((course) => {
                const batches = Object.keys(groupedRecords[course]).sort((a, b) => Number(b) - Number(a));
                const isCourseOpen = expandedCourse === course;

                return (
                    <div key={course} className="records-course-group">
                        <button
                            type="button"
                            className={`records-course-toggle${isCourseOpen ? " open" : ""}`}
                            onClick={() => {
                                setExpandedCourse((prev) => (prev === course ? "" : course));
                                setExpandedBatch("");
                            }}
                        >
                            <span>{programLabel(course)}</span>
                            <span className="records-toggle-count">{batches.length} batch{batches.length === 1 ? "" : "es"}</span>
                        </button>

                        {isCourseOpen && (
                            <div className="records-course-panel">
                                {batches.map((batch) => {
                                    const recordsInBatch = groupedRecords[course][batch];
                                    const isBatchOpen = expandedBatch === `${course}-${batch}`;

                                    return (
                                        <div key={`${course}-${batch}`} className="records-batch-group">
                                            <button
                                                type="button"
                                                className={`records-batch-toggle${isBatchOpen ? " open" : ""}`}
                                                onClick={() =>
                                                    setExpandedBatch((prev) =>
                                                        prev === `${course}-${batch}` ? "" : `${course}-${batch}`
                                                    )
                                                }
                                            >
                                                <span>Batch {batch}</span>
                                                <span className="records-toggle-count">
                                                    {recordsInBatch.length} student{recordsInBatch.length === 1 ? "" : "s"}
                                                </span>
                                            </button>

                                            {isBatchOpen && (
                                                <ul className="records-name-list">
                                                    {recordsInBatch.map((record) => (
                                                        <li
                                                            key={record.id}
                                                            className={`records-name-item${record.id === selectedRecordId ? " highlighted-record" : ""}`}
                                                        >
                                                            <div className="records-name-content">
                                                                <div className="records-name-info">
                                                                    <div>{record.full_name}</div>
                                                                    <div style={{ fontSize: "0.8em", color: "#6b7280", marginTop: "2px" }}>
                                                                        {academicLabel(record.course, record.major, record.batch_year)}
                                                                    </div>
                                                                </div>
                                                                <div>
                                                                    <button
                                                                        type="button"
                                                                        className="records-delete-btn"
                                                                        onClick={(e) => handleDeleteClick(e, record)}
                                                                        disabled={isDeleting(record.id)}
                                                                        title="Delete this record"
                                                                    >
                                                                        {isDeleting(record.id) ? "..." : "🗑 Delete"}
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        </li>
                                                    ))}
                                                </ul>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                );
            })}

            <DeleteConfirmationModal
                show={deleteTarget !== null}
                onHide={() => setDeleteTarget(null)}
                onConfirm={handleDeleteConfirm}
                record={deleteTarget}
                loading={deleteTarget ? isDeleting(deleteTarget.id) : false}
            />
        </div>
    );
}