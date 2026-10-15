import { lazy, Suspense, useRef } from "react";
import { Modal, Spinner } from "react-bootstrap";
import "./MembershipApplicationModal.css";

const MembershipApplicationForm = lazy(() => import("../../pages/MembershipApplicationPage"));
export default function MembershipApplicationModal({ onClose, onConfirmedSave }) {
    const closeRequest = useRef(null);
    const close = () => closeRequest.current ? closeRequest.current() : onClose();
    return <Modal show centered size="xl" fullscreen="sm-down" onHide={close} className="membership-application-modal" aria-labelledby="membership-modal-heading">
        <Modal.Header closeButton><Modal.Title id="membership-modal-heading">DJEMC Membership Application</Modal.Title></Modal.Header>
        <Modal.Body><Suspense fallback={<div className="membership-modal-loading" role="status"><Spinner animation="border" /> Loading application…</div>}>
            <MembershipApplicationForm embedded onClose={onClose} onConfirmedSave={onConfirmedSave} closeRequestRef={closeRequest} />
        </Suspense></Modal.Body>
    </Modal>;
}
