import { Container, Row, Col } from "react-bootstrap";
import heroImage from "../assets/contact-hero.jpg";
import "../pages/Contactpage.css";

export default function Contact() {
    return (
        <div className="contact-page">
            <div
                className="contact-hero"
                style={{
                    backgroundImage: `url(${heroImage})`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                    height: "300px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#fff"
                }}
            >
                <h1 className="display-4 fw-bold highlight-center">
                    Contact DJEMC Alumni Portal
                </h1>
            </div>

            <Container className="my-5">
                <Row className="justify-content-center">
                    <Col md={8}>
                        <h2 className="highlight">Get in Touch</h2>

                        <p>
                            The DJEMC Alumni Portal is dedicated to maintaining strong communication
                            with our graduates. If you encounter any issues with your account,
                            need help updating your alumni profile, or want to inquire about
                            events and job opportunities, feel free to contact us.
                        </p>

                        <p>
                            Our support team works to ensure that alumni stay connected with
                            the DJEMC community, receive important updates, and continue to
                            benefit from the resources available through the portal.
                        </p>

                        <div className="contact-info mt-4">
                            <h4 className="highlight">Contact Information</h4>

                            <p>
                                <strong>Email:</strong> djemc@gmail.com
                            </p>

                            <p>
                                <strong>Phone:</strong> +63 912 345 6789
                            </p>

                            <p>
                                <strong>Address:</strong> DJEMC Campus, BRG Justiniana edera , san jose, Dinagat Islands, Philippines
                            </p>

                            <p>
                                Our office hours are Monday to Friday, 8:00 AM - 5:00 PM.
                                We aim to respond to all inquiries within 24-48 hours.
                            </p>
                        </div>
                    </Col>
                </Row>
            </Container>
        </div>
    );
}
