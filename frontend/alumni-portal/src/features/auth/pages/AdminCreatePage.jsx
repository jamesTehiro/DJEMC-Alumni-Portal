import AdminPortalPage from "./AdminPortalPage";

// Keep the existing URL on the same verification and setup workflow.
export default function AdminCreatePage() {
    return <AdminPortalPage initialMode="create" allowExistingAdmin />;
}
