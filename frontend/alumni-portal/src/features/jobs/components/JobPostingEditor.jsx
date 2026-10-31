import React, { useEffect, useRef, useState } from "react";
import { Alert, Button, Modal, Spinner, Toast, ToastContainer } from "react-bootstrap";
import { api } from "../../../services/api";
import JobPostingForm from "./JobPostingForm";
import JobRequirementsEditor from "./JobRequirementsEditor";
import { jobPostingFormFromJob, jobPostingUpdatePayload, requirementsFromJob } from "../utils/jobPostingEdit";

function EditJobModal({ job, onClose, onSaved }) {
    const [loaded, setLoaded] = useState(null);
    const [form, setForm] = useState(null);
    const [requirements, setRequirements] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    const [saveError, setSaveError] = useState("");
    const [saving, setSaving] = useState(false);
    const busy = useRef(false);
    const [initial, setInitial] = useState("");
    const saveErrorRef = useRef(null);
    const dirty = form !== null && JSON.stringify({ form, requirements }) !== initial;

    useEffect(() => {
        let active = true;
        api.get(`/jobs/${job.id}`, true).then(data => {
            if (!active) return;
            if (!data || String(data.id) !== String(job.id)) throw Error("Unable to load this job posting.");
            const draft = jobPostingFormFromJob(data), items = requirementsFromJob(data);
            setInitial(JSON.stringify({ form: draft, requirements: items }));
            setLoaded(data); setForm(draft); setRequirements(items); setLoading(false);
        }).catch(error => { if (active) { setLoadError(error.message || "Unable to load this job posting."); setLoading(false); } });
        return () => { active = false; };
    }, [job.id]);

    useEffect(() => {
        if (!dirty) return undefined;
        const warn = event => { event.preventDefault(); event.returnValue = ""; };
        window.addEventListener("beforeunload", warn);
        return () => window.removeEventListener("beforeunload", warn);
    }, [dirty]);

    useEffect(() => { if (saveError) saveErrorRef.current?.focus(); }, [saveError]);

    const close = () => {
        if (busy.current) return;
        if (!dirty || window.confirm("Discard unsaved changes to this job posting?")) onClose();
    };
    const save = async () => {
        if (busy.current) return false;
        busy.current = true;
        setSaving(true); setSaveError("");
        try {
            const saved = await api.put(`/jobs/${job.id}`, jobPostingUpdatePayload(form, requirements, loaded), true);
            if (!saved || String(saved.id) !== String(job.id)) throw Error("The server did not confirm the updated job. Please try again.");
            onSaved({ ...loaded, ...saved });
            return true;
        } catch (error) {
            setSaveError(error.message || "Unable to save changes. Please try again.");
            return false;
        } finally { busy.current = false; setSaving(false); }
    };
    return <Modal show onHide={close} size="xl" centered scrollable dialogClassName="job-posting-edit-dialog" aria-labelledby="edit-job-heading">
        <Modal.Header closeButton={!saving}><Modal.Title id="edit-job-heading">Edit Job Posting</Modal.Title></Modal.Header>
        <Modal.Body>
            {loading ? <div role="status"><Spinner animation="border" size="sm" /> Loading job posting…</div> : loadError ? <Alert variant="danger" role="alert">{loadError}<Button variant="link" onClick={close}>Close</Button></Alert> : <>
                {saveError && <Alert variant="danger" role="alert" ref={saveErrorRef} tabIndex={-1}>{saveError}</Alert>}
                <JobPostingForm mode="edit" value={form} onChange={setForm} profile={loaded.User || loaded.employer || job.User} requirements={requirements}
                    requirementsEditor={<JobRequirementsEditor value={requirements} onChange={setRequirements} />}
                    submitting={saving} onPublish={save} onCancel={close} />
            </>}
        </Modal.Body>
    </Modal>;
}

export default function JobPostingEditor({ job, onClose, onSaved }) {
    const [success, setSuccess] = useState(false);
    return <>
        {job && <EditJobModal key={job.id} job={job} onClose={onClose} onSaved={saved => { onSaved(saved); setSuccess(true); onClose(); }} />}
        <ToastContainer position="top-end" className="job-posting-update-toast p-3">
            <Toast show={success} onClose={() => setSuccess(false)} autohide delay={6000} bg="success" role="status" aria-live="polite">
                <Toast.Header><strong className="me-auto">Job Posting</strong></Toast.Header>
                <Toast.Body className="text-white">Job posting updated successfully.</Toast.Body>
            </Toast>
        </ToastContainer>
    </>;
}
