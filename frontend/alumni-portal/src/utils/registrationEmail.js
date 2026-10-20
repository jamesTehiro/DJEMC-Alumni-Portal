export const normalizeRegistrationEmail = value => typeof value === "string" ? value.trim().toLowerCase() : "";
export const isRegistrationGmail = value => {
    const email = normalizeRegistrationEmail(value);
    return email.length <= 254 && email.split("@")[0].length <= 64
        && /^[a-z0-9]+(?:\.[a-z0-9]+)*(?:\+[a-z0-9._-]+)?@gmail\.com$/.test(email);
};
