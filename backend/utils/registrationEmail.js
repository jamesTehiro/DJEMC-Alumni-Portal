const normalizeEmail = value => typeof value === "string" ? value.trim().toLowerCase() : "";

// Keep this expression identical to emailKey(), including for legacy accounts.
// The generated database key also protects writes outside the registration API.
const EMAIL_KEY_SQL = "CASE WHEN SUBSTRING_INDEX(LOWER(TRIM(`email`)), '@', -1) IN ('gmail.com', 'googlemail.com') THEN CONCAT(REPLACE(SUBSTRING_INDEX(SUBSTRING_INDEX(LOWER(TRIM(`email`)), '@', 1), '+', 1), '.', ''), '@gmail.com') ELSE LOWER(TRIM(`email`)) END";
const emailKey = value => {
    const email = normalizeEmail(value);
    const [local, domain] = email.split("@");
    return ["gmail.com", "googlemail.com"].includes(domain)
        ? `${local.split("+")[0].replaceAll(".", "")}@gmail.com` : email;
};
const isGmail = value => {
    const email = normalizeEmail(value);
    return email.length <= 254 && email.split("@")[0].length <= 64
        && /^[a-z0-9]+(?:\.[a-z0-9]+)*(?:\+[a-z0-9._-]+)?@gmail\.com$/.test(email);
};

module.exports = { normalizeEmail, emailKey, isGmail, EMAIL_KEY_SQL };
