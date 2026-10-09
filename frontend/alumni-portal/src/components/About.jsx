import { Container, Row, Col } from "react-bootstrap";
import heroImage from "../assets/about-hero.jpg";
import "../pages/Aboutpage.css";

export default function About() {
    return (
        <div className="about-page">
            <div
                className="about-hero"
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
                <h1 className="display-4 fw-bold">About DJEMC Alumni Portal</h1>
            </div>

            <Container className="my-5">
                <Row className="justify-content-center">
                    <Col md={10}>
                        <h2>
                            <span className="highlight">Welcome to the DJEMC Alumni Portal</span>
                        </h2>

                        <p>
                            <span className="highlight">The DJEMC Alumni Portal</span> is a centralized platform designed to
                            connect past students of DJEMC. Our goal is to provide a seamless
                            experience for alumni to stay updated with the latest events,
                            job opportunities, and community news.
                        </p>

                        <h4 className="section-title">Our Mission</h4>
                        <p>
                            We aim to foster a strong network among alumni, helping
                            individuals grow professionally and personally while keeping
                            the DJEMC community vibrant and engaged.
                        </p>

                        <h4 className="section-title">Features</h4>
                        <ul>
                            <li>View and update your alumni profile.</li>
                            <li>Access exclusive job postings from employers.</li>
                            <li>Receive notifications about events and opportunities.</li>
                            <li>Connect with other alumni for mentorship and networking.</li>
                        </ul>

                        <h4 className="section-title">Contact</h4>
                        <p>
                            For questions or support, reach out to our team via the
                            <span className="highlight"> Contact page</span>.
                        </p>
                    </Col>
                </Row>
            </Container>
        </div>
    );
}
