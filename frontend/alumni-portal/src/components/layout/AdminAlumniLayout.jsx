import { Suspense, useState } from "react";
import { Outlet } from "react-router-dom";
import AdminShell from "./AdminShell";
import { AdminShellContext } from "./AdminShellContext";

export default function AdminAlumniLayout() {
    const [header, setHeader] = useState({});
    return (
        <AdminShell scope="alumni" {...header}>
            <AdminShellContext.Provider value={setHeader}>
                <Suspense fallback={<div className="route-loading">Loading...</div>}>
                    <Outlet />
                </Suspense>
            </AdminShellContext.Provider>
        </AdminShell>
    );
}
