import React from "react";
import { Button, Modal } from "react-bootstrap";

export default function AlumniDataPrivacyModal({ show, onHide, onAgree }) {
    return (
        <Modal show={show} onHide={onHide} size="lg" centered scrollable>
            <Modal.Header closeButton>
                <Modal.Title>Alumni Data Privacy Consent</Modal.Title>
            </Modal.Header>
            <Modal.Body>
                <p>
                    Welcome to the Alumni Portal. Your privacy is important to us, and we are committed to protecting your personal information.
                </p>
                <p>
                    By registering as an alumni, you provide personal data such as your full name, email, date of birth, employment history, educational background, and other information you voluntarily provide. This information is collected solely for the purpose of connecting alumni, sharing updates, job postings, and facilitating career opportunities.
                </p>
                <p>
                    We handle all personal data securely using industry-standard encryption and access control measures. Your data will only be accessed by authorized personnel and will not be shared with third parties without your explicit consent, except where required by law.
                </p>
                <p>
                    By agreeing to this Data Privacy Consent, you acknowledge that you understand and accept how your information will be collected, used, stored, and protected. You also agree that we may contact you regarding relevant job postings, alumni events, and portal updates.
                </p>
                <p>
                    We may occasionally update this policy to reflect changes in our practices or applicable laws. The most current version of the policy will always be available on the portal. Continued use of the Alumni Portal constitutes acceptance of any changes.
                </p>
            </Modal.Body>
            <Modal.Footer>
                <Button variant="primary" onClick={onAgree || onHide}>
                    I Understand & Agree
                </Button>
            </Modal.Footer>
        </Modal>
    );
}
