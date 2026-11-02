import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal } from 'react-bootstrap';
import { api } from '../../../services/api';

const countLabels = {
    Job: 'Posted jobs', Application: 'Applications', ApplicationDocument: 'Application documents',
    ApplicationFiles: 'Legacy application files', ApplicationResponse: 'Application responses',
    JobRequirementSnapshot: 'Requirement snapshots', JobRequirement: 'Job requirements', RequirementGroup: 'Requirement groups',
    Interview: 'Interviews', Resume: 'Saved resumes', ResumeVersion: 'Resume versions',
    AlumniProfile: 'Alumni profiles', EmployerProfile: 'Employer profiles', EmploymentHistory: 'Employment history entries',
    Notification: 'Account notifications', PasswordResetToken: 'Password reset tokens',
    AlumniProfileUpdateRequest: 'Profile update requests', RegistrationEmailVerification: 'Consumed registration verifications',
    MessageSendRequest: 'Message request receipts', ConversationParticipant: 'Departing conversation memberships',
    MembershipAdministrator: 'Membership access grants'
};

export default function AccountDeletionModal({ item, role, endpoint, onClose, onDeleted, onBusyChange }) {
    const [preview, setPreview] = useState(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [confirmation, setConfirmation] = useState('');
    const [error, setError] = useState('');
    const inFlight = useRef(false);
    const generation = useRef(0);
    const fetchPreview = useCallback(async request => {
        try {
            const data = await api.get(`${endpoint}/${item.id}/deletion-impact`, true);
            if (request !== generation.current) return;
            if (data?.account?.id !== item.id || data?.account?.role !== role || !data?.confirmationToken) throw new Error('The server did not confirm this account. Reload the preview.');
            setPreview(data);
        } catch (failure) { if (request === generation.current) setError(failure.message || 'Unable to load deletion impact.'); }
        finally { if (request === generation.current) setLoading(false); }
    }, [endpoint, item.id, role]);
    // The parent keys this dialog by role/account so every opening starts clean.
    useEffect(() => {
        fetchPreview(++generation.current);
        return () => { generation.current += 1; };
    }, [fetchPreview]);
    const load = () => {
        setLoading(true); setPreview(null); setConfirmation(''); setError('');
        fetchPreview(++generation.current);
    };
    const close = () => { if (!inFlight.current) onClose(); };
    const submit = async () => {
        if (inFlight.current || loading || !preview?.canDelete || confirmation !== 'DELETE') return;
        inFlight.current = true; setBusy(true); setError(''); onBusyChange(true);
        try {
            const result = await api.delete(`${endpoint}/${item.id}`, true, { data: { confirmation, confirmationToken: preview.confirmationToken } });
            if (result?.success !== true || result?.deletedUserId !== item.id || result?.role !== role) throw new Error('The server did not confirm deletion. Refresh the user list before retrying.');
            onDeleted(result);
        } catch (failure) {
            setError(failure.message || 'Account deletion failed.');
            setPreview(null); setConfirmation('');
        } finally { inFlight.current = false; setBusy(false); onBusyChange(false); }
    };
    const account = preview?.account || item;
    return <Modal show onHide={close} centered scrollable backdrop={busy ? 'static' : true} keyboard={!busy} aria-labelledby="account-delete-title">
        <Modal.Header closeButton={!busy}><Modal.Title id="account-delete-title">Delete Account Permanently?</Modal.Title></Modal.Header>
        <Modal.Body>
            <p>You are about to permanently delete:</p>
            <dl>
                <dt>Account</dt><dd>{account.name}</dd>
                <dt>Email</dt><dd style={{ overflowWrap: 'anywhere' }}>{account.email}</dd>
                <dt>Role</dt><dd>{role === 'employer' ? 'Employer' : 'Alumni'}</dd>
            </dl>
            <p>This action will remove the account and its associated data according to the deletion policy.</p>
            <p>{role === 'employer' ? 'Associated job postings, applications, and application documents will be removed. Alumni accounts and saved resumes will be preserved.' : 'Submitted applications, saved resumes, and private account documents will be removed. Employer job postings will be preserved.'}</p>
            <p>All membership forms, Registrar master records, shared messages and attachments, forum content, audit logs, and email history will be preserved. Shared account references will display “Deleted account”. Queued email to this account will be cancelled.</p>
            <strong>This action cannot be undone.</strong>
            <h6 className="mt-3">Deletion impact</h6>
            {loading && <p role="status">Loading actual database counts...</p>}
            {preview && <>
                <table className="table table-sm"><caption>Records to remove</caption><tbody>
                    {Object.entries(preview.counts).map(([name, count]) => <tr key={name}><th scope="row">{countLabels[name] || name.replace(/^Resume/, 'Resume ').replace(/([a-z])([A-Z])/g, '$1 $2')}</th><td>{count}</td></tr>)}
                </tbody></table>
                <p>Preserved membership forms: {preview.preserved?.['MembershipApplication.alumni_user_id'] || 0}. Shared messages: {(preview.preserved?.['Message.sender_id'] || 0) + (preview.preserved?.['EmployerMessage.senderId'] || 0)}.</p>
                {preview.blockers?.map(blocker => <p key={blocker} className="notice error" role="alert">{blocker}</p>)}
            </>}
            {error && <p className="notice error" role="alert">{error}</p>}
            <button type="button" className="secondary-btn mb-3" onClick={load} disabled={busy || loading}>Refresh impact preview</button>
            <label className="field" htmlFor="account-delete-confirmation"><span>Type DELETE to confirm</span>
                <input id="account-delete-confirmation" className="saas-input" autoComplete="off" spellCheck={false} value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={busy || loading || !preview?.canDelete} />
            </label>
            {busy && <p role="status">Permanently deleting account...</p>}
        </Modal.Body>
        <Modal.Footer>
            <button type="button" className="secondary-btn" onClick={close} disabled={busy}>Cancel</button>
            <button type="button" className="btn btn-danger" onClick={submit} disabled={busy || loading || !preview?.canDelete || confirmation !== 'DELETE'}>{busy ? 'Deleting...' : 'Permanently Delete Account'}</button>
        </Modal.Footer>
    </Modal>;
}
