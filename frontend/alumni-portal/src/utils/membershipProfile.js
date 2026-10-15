// Membership information stays private. Only compatible profile fields are offered.
export function membershipProfileValues(application) {
    const personal = application?.personal_details || {};
    return {
        name: [personal.first_name, personal.middle_name, personal.last_name, personal.extension].filter(Boolean).join(" ").trim(),
        phone: personal.contact_number || "",
        address: personal.current_address || "",
        job_title: personal.designation || personal.occupation || ""
    };
}

export function fillEmptyProfileFields(form, application) {
    const next = { ...form };
    for (const [key, value] of Object.entries(membershipProfileValues(application))) {
        if (!String(next[key] || "").trim() && value) next[key] = value;
    }
    return next;
}

export function membershipProfileChanges(form, application) {
    return Object.entries(membershipProfileValues(application))
        .filter(([key, value]) => value && value !== (form[key] || ""))
        .map(([key, value]) => ({ key, value }));
}
