import React from "react";
import AdminAlumniMessagesPage from "../AdminAlumniMessagesPage";
import AdminEmployerMessagesPage from "../AdminEmployerMessagesPage";

export default function AdminMessagesPage({ role }) {
    return role === "alumni" ? <AdminAlumniMessagesPage /> : <AdminEmployerMessagesPage />;
}
