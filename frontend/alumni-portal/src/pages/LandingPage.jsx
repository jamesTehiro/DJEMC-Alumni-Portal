import { useState, useEffect, useRef } from "react";
import { Container, Row, Col, Button, Card } from "react-bootstrap";
import { FaUserGraduate, FaBriefcase, FaBell } from "react-icons/fa";
import { FiMail, FiMapPin, FiPhone } from "react-icons/fi";
import { useNavigate } from "react-router-dom";
import "./LandingPage.css";
import "./Aboutpage.css";
import "./Contactpage.css";

// Import images from src/assets
import campus from "../assets/campus.jpg";
import em1 from "../assets/em1.png";
import em2 from "../assets/em2.png";
import meeting3 from "../assets/meeting3.jpg";
import meeting4 from "../assets/meeting4.jpg";
import meeting5 from "../assets/meeting5.jpg";
import meeting6 from "../assets/meeting6.jpg";
import aboutHero from "../assets/about-hero.jpg";
import contactHero from "../assets/contact-hero.jpg";

const heroImages = [campus, em1, em2, meeting3, meeting4, meeting5, meeting6];

export default function LandingPage({ currentPage = "landing", onSectionChange = null }) {
    const [currentImage, setCurrentImage] = useState(0);
    const navigate = useNavigate();
    const homeRef = useRef(null);
    const aboutRef = useRef(null);
    const contactRef = useRef(null);
    const isAutoScrollingRef = useRef(false);
    const pendingSectionRef = useRef(null);
    const scrollResetTimerRef = useRef(null);

    // Automatically change hero image every 5 seconds
    useEffect(() => {
        const interval = setInterval(() => {
            setCurrentImage((prev) => (prev + 1) % heroImages.length);
        }, 5000);

        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        return () => {
            if (scrollResetTimerRef.current) {
                window.clearTimeout(scrollResetTimerRef.current);
            }
        };
    }, []);

    useEffect(() => {
        const sectionMap = {
            landing: homeRef.current,
            about: aboutRef.current,
            contact: contactRef.current,
        };

        const target = sectionMap[currentPage];
        if (!target) return;

        pendingSectionRef.current = currentPage;
        isAutoScrollingRef.current = true;

        if (scrollResetTimerRef.current) {
            window.clearTimeout(scrollResetTimerRef.current);
        }

        target.scrollIntoView({
            behavior: "smooth",
            block: currentPage === "landing" ? "start" : "start",
        });

        scrollResetTimerRef.current = window.setTimeout(() => {
            isAutoScrollingRef.current = false;
            pendingSectionRef.current = null;
        }, 900);
    }, [currentPage]);

    useEffect(() => {
        const sections = [
            { key: "landing", element: homeRef.current },
            { key: "about", element: aboutRef.current },
            { key: "contact", element: contactRef.current },
        ].filter((section) => section.element);

        if (!sections.length || typeof onSectionChange !== "function") {
            return undefined;
        }

        const observer = new IntersectionObserver(
            (entries) => {
                const visibleEntry = entries
                    .filter((entry) => entry.isIntersecting)
                    .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

                const nextSection = visibleEntry?.target?.dataset?.section;
                if (!nextSection) {
                    return;
                }

                if (isAutoScrollingRef.current) {
                    if (nextSection !== pendingSectionRef.current) {
                        return;
                    }

                    isAutoScrollingRef.current = false;
                    pendingSectionRef.current = null;

                    if (scrollResetTimerRef.current) {
                        window.clearTimeout(scrollResetTimerRef.current);
                        scrollResetTimerRef.current = null;
                    }
                }

                if (nextSection !== currentPage) {
                    onSectionChange(nextSection);
                }
            },
            {
                root: null,
                threshold: [0.3, 0.55, 0.8],
                rootMargin: "-20% 0px -35% 0px",
            }
        );

        sections.forEach((section) => observer.observe(section.element));

        return () => observer.disconnect();
    }, [currentPage, onSectionChange]);

    const renderLandingSection = () => (
        <section ref={homeRef} data-section="landing" className="landing-stacked-home">
            <div
                className="hero-section"
                style={{
                    backgroundImage: `url(${heroImages[currentImage]})`,
                }}
            >
                <Container fluid className="hero-content text-white">
                    <Row className="hero-layout align-items-center justify-content-center">
                        <Col lg={8} xl={7} className="hero-copy">
                            <h1 className="hero-title">
                                EMPOWERING FUTURES <br />
                                CONNECTING ALUMNI
                            </h1>

                            <p className="hero-subtitle">Your lifetime portal is here</p>

                            <div className="hero-buttons">
                                <Button
                                    variant="primary"
                                    size="lg"
                                    className="hero-glass-btn"
                                    onClick={() => navigate("/login/alumni")}
                                >
                                    <FaUserGraduate
                                        style={{ marginRight: "8px", fontSize: "20px" }}
                                    />
                                    Alumni Portal
                                </Button>

                                <Button
                                    variant="success"
                                    size="lg"
                                    className="hero-glass-btn"
                                    onClick={() => navigate("/login/employer")}
                                >
                                    <FaBriefcase style={{ marginRight: "8px", fontSize: "20px" }} />
                                    Employer Portal
                                </Button>

                            </div>
                        </Col>
                    </Row>
                </Container>
            </div>

            <section className="features">
                <Container>
                    <div className="features-intro text-center">
                        <p className="features-kicker">Why Choose DJEMC Alumni Portal</p>
                        <h2 className="features-title">
                            A smarter alumni experience built for connection, careers, and campus updates.
                        </h2>
                        <p className="features-description">
                            Everything important lives in one polished hub, from professional networking to exclusive opportunities and real-time school communication.
                        </p>
                    </div>

                    <Row className="g-4">
                        <Col md={4}>
                            <Card className="feature-card feature-card-modern text-center p-4">
                                <div className="feature-icon-shell">
                                    <FaUserGraduate size={34} className="icon" />
                                </div>
                                <p className="feature-label">Community</p>
                                <h4 className="mt-3">Alumni Network</h4>
                                <p>Connect with thousands of DJEMC graduates through one shared digital home.</p>
                            </Card>
                        </Col>

                        <Col md={4}>
                            <Card className="feature-card feature-card-modern text-center p-4">
                                <div className="feature-icon-shell">
                                    <FaBriefcase size={34} className="icon" />
                                </div>
                                <p className="feature-label">Career Growth</p>
                                <h4 className="mt-3">Job Opportunities</h4>
                                <p>Access exclusive job postings and employer connections tailored for alumni.</p>
                            </Card>
                        </Col>

                        <Col md={4}>
                            <Card className="feature-card feature-card-modern text-center p-4">
                                <div className="feature-icon-shell">
                                    <FaBell size={34} className="icon" />
                                </div>
                                <p className="feature-label">Instant Updates</p>
                                <h4 className="mt-3">Real-time Notifications</h4>
                                <p>Stay updated with announcements, events, and alerts the moment they happen.</p>
                            </Card>
                        </Col>
                    </Row>
                </Container>
            </section>
        </section>
    );

    const renderAboutSection = () => (
        <section ref={aboutRef} data-section="about" className="landing-section-panel landing-info-panel">
            <div
                className="landing-section-hero about-hero"
                style={{
                    backgroundImage: `url(${aboutHero})`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                    height: "300px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#fff",
                }}
            >
                <div className="landing-section-hero-copy text-center">
                    <p className="landing-section-kicker">About</p>
                    <h1 className="display-4 fw-bold">About DJEMC Alumni Portal</h1>
                    <p className="landing-section-lead">
                        A connected alumni experience built around community, career growth, and lasting school ties.
                    </p>
                </div>
            </div>

            <Container className="landing-section-body py-5">
                <Row className="g-4 align-items-start justify-content-center">
                    <Col lg={7}>
                        <h2 className="landing-section-title">
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
                    </Col>

                    <Col lg={4}>
                        <Card className="landing-detail-card h-100">
                            <Card.Body>
                                <p className="landing-card-kicker">Core Features</p>
                                <h4 className="section-title">What alumni can do here</h4>
                                <ul className="landing-feature-list">
                                    <li>View and update your alumni profile.</li>
                                    <li>Access exclusive job postings from employers.</li>
                                    <li>Receive notifications about events and opportunities.</li>
                                    <li>Connect with other alumni for mentorship and networking.</li>
                                </ul>
                                <p className="landing-card-note">
                                    For questions or support, reach out through the
                                    <span className="highlight"> Contact</span> section.
                                </p>
                            </Card.Body>
                        </Card>
                    </Col>
                </Row>
            </Container>
        </section>
    );

    const renderContactSection = () => (
        <section ref={contactRef} data-section="contact" className="landing-section-panel landing-contact-panel">
            <div
                className="landing-section-hero contact-hero"
                style={{
                    backgroundImage: `url(${contactHero})`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                    height: "300px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#fff",
                }}
            >
                <div className="landing-section-hero-copy text-center">
                    <p className="landing-section-kicker">Contact</p>
                    <h1 className="display-4 fw-bold highlight-center">
                        Contact DJEMC Alumni Portal
                    </h1>
                    <p className="landing-section-lead">
                        Reach the portal team for account help, alumni support, and community concerns.
                    </p>
                </div>
            </div>

            <Container className="landing-section-body py-5">
                <Row className="g-4 justify-content-center">
                    <Col lg={8}>
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
                        </div>
                    </Col>

                    <Col md={10} lg={8}>
                        <Row className="g-4">
                            <Col md={4}>
                                <Card className="landing-contact-card h-100 text-center">
                                    <Card.Body>
                                        <FiMapPin className="landing-contact-icon" />
                                        <h4 className="landing-contact-title">Address</h4>
                                        <p className="mb-0">Justiniana Edera,  San Jose,  Dinagat Islands  </p>
                                    </Card.Body>
                                </Card>
                            </Col>

                            <Col md={4}>
                                <Card className="landing-contact-card h-100 text-center">
                                    <Card.Body>
                                        <FiMail className="landing-contact-icon" />
                                        <h4 className="landing-contact-title">Email</h4>
                                        <p className="mb-0">alumni@gmail.com</p>
                                    </Card.Body>
                                </Card>
                            </Col>

                            <Col md={4}>
                                <Card className="landing-contact-card h-100 text-center">
                                    <Card.Body>
                                        <FiPhone className="landing-contact-icon" />
                                        <h4 className="landing-contact-title">Phone</h4>
                                        <p className="mb-0">+63 912 345 6789</p>
                                    </Card.Body>
                                </Card>
                            </Col>
                        </Row>

                        <div className="landing-contact-footnote text-center mt-4">
                            Our office hours are Monday to Friday, 8:00 AM - 5:00 PM. We aim to respond within 24-48 hours.
                        </div>
                    </Col>
                </Row>
            </Container>
        </section>
    );

    return (
        <>
            {renderLandingSection()}
            {renderAboutSection()}
            {renderContactSection()}
        </>
    );
}
