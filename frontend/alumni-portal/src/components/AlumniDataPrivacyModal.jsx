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
                    <strong>Welcome to the Don Jose Ecleo Memorial College
                        (DJEMC) Alumni Tracking and Job Portal.</strong>
                </p>

                <p>
                    DJEMC respects your privacy and is committed to protecting
                    your personal information in accordance with the Data Privacy
                    Act of 2012 (Republic Act No. 10173) of the Philippines and
                    other applicable privacy regulations.
                </p>

                <h6>1. Personal Information We Collect</h6>
                <p>
                    When you register and use the Alumni Portal, we may collect
                    personal information such as your full name, email address,
                    contact information, date of birth, graduation year, academic
                    background, employment history, skills, and other information
                    you choose to provide.
                </p>

                <h6>2. Purpose of Data Collection</h6>
                <p>
                    Your information will be used to verify alumni registration,
                    maintain alumni records, facilitate communication between
                    alumni and the college, share announcements and events,
                    provide employment and career opportunities, support job
                    applications, and improve the services offered by the portal.
                </p>

                <h6>3. Data Storage and Security</h6>
                <p>
                    Appropriate organizational, physical, and technical safeguards
                    will be applied to protect your personal information against
                    unauthorized access, disclosure, alteration, loss, or misuse.
                    Access to your information will be limited to authorized
                    personnel and other authorized users where necessary for the
                    portal's legitimate functions.
                </p>

                <h6>4. Sharing and Disclosure of Information</h6>
                <p>
                    Your personal information will only be shared when necessary
                    for the purposes described in this notice, with authorized
                    recipients, or when disclosure is permitted or required by law.
                    Information relevant to employment opportunities may be made
                    available to employers when necessary for recruitment and
                    subject to applicable privacy requirements.
                </p>

                <h6>5. Data Retention</h6>
                <p>
                    Your personal information will be retained only for as long
                    as necessary to fulfill the purposes for which it was collected,
                    comply with applicable legal obligations, and support legitimate
                    institutional recordkeeping requirements. Information will be
                    securely disposed of or anonymized when retention is no longer
                    necessary, subject to applicable laws.
                </p>

                <h6>6. Your Data Privacy Rights</h6>
                <p>
                    Subject to applicable law, you may have the right to be informed
                    about the processing of your personal information, access your
                    data, request corrections, object to certain processing, request
                    deletion or blocking where applicable, and exercise other rights
                    provided under the Data Privacy Act of 2012.
                </p>

                <h6>7. Communication and Notifications</h6>
                <p>
                    The portal may send service-related communications, including
                    account verification, application updates, recruitment decisions,
                    announcements, and other notifications relevant to your account.
                    Optional promotional or other communications will be handled in
                    accordance with applicable privacy requirements and your
                    preferences where applicable.
                </p>

                <h6>8. Consent and Policy Updates</h6>
                <p>
                    By selecting "I Understand & Agree," you acknowledge that you
                    have read and understood this privacy notice and consent to the
                    processing of your personal information for the purposes
                    described above, where consent is the applicable legal basis.
                    Processing activities based on other lawful grounds will be
                    handled in accordance with applicable law.
                </p>

                <p>
                    If this privacy notice changes, the updated version will be
                    made available through the portal. Where required, additional
                    notice or consent will be obtained before implementing changes
                    that require it.
                </p>

                <p>
                    If you have questions about how your personal information is
                    handled or wish to exercise your data privacy rights, please
                    contact the college through its designated data privacy contact
                    or official communication channels.
                </p>

                <p className="text-muted small mb-0">
                    Please read this notice carefully before proceeding with
                    registration.
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
