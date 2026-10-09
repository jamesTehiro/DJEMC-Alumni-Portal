import { useEffect, useState } from "react";
import { Container, Nav, Navbar } from "react-bootstrap";
import { Link, useLocation, useNavigate } from "react-router-dom";
import logo from "../assets/logo.png";
import secondaryLogo from "../assets/alumni-logo.jpg";

const PUBLIC_PATHS = {
    landing: "/",
    about: "/about",
    contact: "/contact"
};

export default function NavigationBar({ currentPage = null, onNavigate = null }) {
    const location = useLocation();
    const navigate = useNavigate();
    const [isShrunk, setIsShrunk] = useState(false);
    const [expanded, setExpanded] = useState(false);
    const isPublicRoute = Object.values(PUBLIC_PATHS).includes(location.pathname);
    const activePage = isPublicRoute
        ? currentPage || (location.pathname === "/about" ? "about" : location.pathname === "/contact" ? "contact" : "landing")
        : null;
    const isLandingPage = isPublicRoute ? activePage === "landing" : location.pathname === "/";

    useEffect(() => {
        if (!isPublicRoute) {
            setIsShrunk(false);
            return;
        }

        const handleScroll = () => {
            setIsShrunk(window.scrollY > 24 || activePage !== "landing");
        };

        handleScroll();
        window.addEventListener("scroll", handleScroll);

        return () => window.removeEventListener("scroll", handleScroll);
    }, [activePage, isPublicRoute]);

    useEffect(() => {
        setExpanded(false);
    }, [location.pathname, currentPage]);

    const handlePageChange = (page) => {
        setExpanded(false);
        if (isPublicRoute && typeof onNavigate === "function") {
            onNavigate(page);
            return;
        }

        navigate(PUBLIC_PATHS[page] || "/");
    };

    return (
        <Navbar
            expand="lg"
            expanded={expanded}
            className={`navbar-custom${isLandingPage ? " navbar-landing" : ""}${isShrunk ? " navbar-public-shrink" : ""}${!isPublicRoute ? " navbar-app" : ""}`}
        >
            <Container>
                <Navbar.Brand
                    as={isPublicRoute ? "button" : Link}
                    to={isPublicRoute ? undefined : "/"}
                    type={isPublicRoute ? "button" : undefined}
                    onClick={isPublicRoute ? () => handlePageChange("landing") : undefined}
                    className="brand-wrapper"
                >
                    <img src={logo} alt="DJEMC Logo" className="brand-logo" />
                    <div className="brand-text">
                        <span className="brand-title">DON JOSE ECLEO MEMORIAL COLLEGE</span>
                        <span className="brand-subtitle">Alumni Tracking and Job Portal</span>
                    </div>
                    <img src={secondaryLogo} alt="Partner Logo" className="brand-side-logo" />
                </Navbar.Brand>
                {isPublicRoute && (
                    <>
                        <Navbar.Toggle
                            aria-controls="public-navbar-nav"
                            className="navbar-mobile-toggle"
                            onClick={() => setExpanded((prev) => !prev)}
                        />
                        <Navbar.Collapse id="public-navbar-nav" className="navbar-collapse-shell">
                            <Nav className="ms-auto nav-links">
                                <Nav.Link
                                    as="button"
                                    type="button"
                                    className={activePage === "landing" ? "active" : ""}
                                    onClick={() => handlePageChange("landing")}
                                >
                                    Home
                                </Nav.Link>
                                <Nav.Link
                                    as="button"
                                    type="button"
                                    className={activePage === "about" ? "active" : ""}
                                    onClick={() => handlePageChange("about")}
                                >
                                    About
                                </Nav.Link>
                                <Nav.Link
                                    as="button"
                                    type="button"
                                    className={activePage === "contact" ? "active" : ""}
                                    onClick={() => handlePageChange("contact")}
                                >
                                    Contact
                                </Nav.Link>
                            </Nav>
                        </Navbar.Collapse>
                    </>
                )}
            </Container>
        </Navbar>
    );
}
