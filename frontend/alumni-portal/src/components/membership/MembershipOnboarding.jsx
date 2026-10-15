import { useState } from "react";
import { Alert, Button, Modal } from "react-bootstrap";
import { useNavigate } from "react-router-dom";
import { useMembershipFlow } from "../../context/membershipFlow";

// Completion comes from MariaDB. Closing the invitation only closes this modal.
export default function MembershipOnboarding() {
    const navigate = useNavigate();
    const flow = useMembershipFlow();
    const [dismissed, setDismissed] = useState(false);

    if (!flow) return null;
    const { data: state, error, loading, open, openForm, retry } = flow;
    const show = !loading && state?.eligible === true && !state.completion?.submitted && !dismissed && !open;

    return <>
        {error && <Alert variant="warning" className="mb-3">
            {error} <Button size="sm" variant="outline-success" onClick={retry}>Retry</Button>
        </Alert>}
        {!loading && state?.completion?.submitted && !state.completion.profile_completed && <Alert variant="success" className="mb-3">
            Your membership application is submitted. Continue completing your alumni profile.
            <Button className="ms-2" size="sm" variant="outline-success" onClick={() => navigate("/profile?membership=1")}>Continue Profile Information</Button>
        </Alert>}
        <Modal show={show} onHide={() => setDismissed(true)} centered aria-labelledby="membership-invitation-title">
            <Modal.Header closeButton><Modal.Title id="membership-invitation-title">Welcome to the DJEMC Alumni Association!</Modal.Title></Modal.Header>
            <Modal.Body>
                <p>To complete your alumni association membership information, please fill out the official Membership Application Form. Your information will be securely stored and used for authorized alumni association purposes.</p>
                {state?.application?.application_status === "draft" && <p className="mb-0">Your saved draft is ready to continue.</p>}
            </Modal.Body>
            <Modal.Footer>
                <Button variant="outline-secondary" onClick={() => setDismissed(true)}>Later</Button>
                <Button variant="success" onClick={() => { setDismissed(true); openForm(); }}>{state?.application?.application_status === "draft" ? "Continue Membership Application" : "Fill Up Membership Application"} →</Button>
            </Modal.Footer>
        </Modal>
    </>;
}
