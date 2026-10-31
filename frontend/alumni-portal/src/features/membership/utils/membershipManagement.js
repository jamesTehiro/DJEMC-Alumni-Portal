export function membershipStatus(value) {
    const status = String(value || "").toLowerCase();
    if (["submitted", "pending_review"].includes(status)) return { label: "Pending Review", tone: "pending" };
    if (status === "approved") return { label: "Approved", tone: "approved" };
    if (status === "for_correction") return { label: "For Correction", tone: "correction" };
    return { label: status === "draft" ? "Draft" : "Status unavailable", tone: "neutral" };
}
export const emptyMembershipFilters = () => ({ search: "", graduation_year: "", submitted_date: "" });
export function membershipManagementQuery(filters, page, pageSize) {
    const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
    for (const key of ["search", "graduation_year", "submitted_date"]) if (filters[key]?.trim()) params.set(key, filters[key].trim());
    return params.toString();
}
export function validateMembershipListResponse(response) {
    if (!Array.isArray(response?.applications) || !Number.isInteger(response.total) || response.total < 0 ||
        response.applications.some(row => !row || !Number.isSafeInteger(Number(row.id)) || Number(row.id) <= 0)) throw new Error("The membership application list could not be loaded. Please retry.");
    if (!Array.isArray(response.filter_options?.graduation_years)) throw new Error("Membership filters could not be loaded. Please retry.");
    return response;
}
export const membershipRowNumber = (page, pageSize, index) => (page - 1) * pageSize + index + 1;
export const canOpenMembershipForm = data => data?.eligible === true && data?.completion?.submitted === false;
export const isMembershipManagementUser = user => user?.role === "admin" && user?.admin_scope === "alumni";
