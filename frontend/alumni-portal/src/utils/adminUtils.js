export const ADMIN_SCOPE_META = {
    alumni: {
        scope: "alumni",
        label: "Alumni",
        lowerLabel: "alumni",
        usersEndpoint: "/admin/alumni/users",
        warningsEndpoint: "/admin/alumni/warnings",
        logsSecondaryEndpoint: "/admin/alumni/announcements"
    },
    employer: {
        scope: "employer",
        label: "Employer",
        lowerLabel: "employer",
        usersEndpoint: "/admin/employer/users",
        warningsEndpoint: "/admin/employer/warnings",
        logsSecondaryEndpoint: "/admin/employer/jobs"
    }
};

export const getStoredUser = () => {
    try {
        return JSON.parse(localStorage.getItem("user") || "null");
    } catch {
        return null;
    }
};

export const isAllowedAdminScope = (user, role) =>
    user?.role === "admin" && (role === "alumni" ? (user?.admin_scope || "alumni") === "alumni" : user?.admin_scope === "employer");

export const clearSessionAndGoHome = (navigate) => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    navigate("/");
};
