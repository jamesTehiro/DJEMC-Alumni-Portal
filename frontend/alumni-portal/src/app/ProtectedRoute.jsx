import React, { useMemo } from "react";
import { Navigate } from "react-router-dom";

export default function ProtectedRoute({ children, allow, redirectTo = "/login" }) {
    const user = useMemo(() => {
        try {
            return JSON.parse(localStorage.getItem("user") || "null");
        } catch {
            return null;
        }
    }, []);

    if (!user) {
        return <Navigate to={redirectTo} replace />;
    }

    if (typeof allow === "function" && !allow(user)) {
        return <Navigate to={redirectTo} replace />;
    }

    return children;
}
