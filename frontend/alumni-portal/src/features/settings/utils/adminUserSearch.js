export function filterAdminUsers(users, query, role) {
    const normalizedQuery = String(query || "").trim().toLowerCase();
    if (!normalizedQuery) return users;

    return users.filter((item) => {
        const name = role === "employer"
            ? `${item.EmployerProfile?.organization_name || ""} ${item.name || ""}`
            : item.name || "";
        return [name, item.email]
            .some((value) => String(value || "").toLowerCase().includes(normalizedQuery));
    });
}
