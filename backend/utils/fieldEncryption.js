const crypto = require("crypto");

const ENCRYPTION_PREFIX = "enc:gcm:";

const getKey = () => {
    const raw = String(process.env.FIELD_ENCRYPTION_KEY || "").trim();
    if (!raw) return null;
    return crypto.createHash("sha256").update(raw).digest();
};

const encrypt = (value) => {
    if (value === undefined || value === null || value === "") return value;
    const key = getKey();
    if (!key) return value;

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();

    return `${ENCRYPTION_PREFIX}${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
};

const decrypt = (value) => {
    if (value === undefined || value === null || value === "") return value;
    if (!String(value).startsWith(ENCRYPTION_PREFIX)) return value;

    const key = getKey();
    if (!key) return value;

    try {
        const payload = String(value).slice(ENCRYPTION_PREFIX.length);
        const [ivHex, tagHex, dataHex] = payload.split(":");
        const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
        decipher.setAuthTag(Buffer.from(tagHex, "hex"));
        const decrypted = Buffer.concat([
            decipher.update(Buffer.from(dataHex, "hex")),
            decipher.final()
        ]);
        return decrypted.toString("utf8");
    } catch {
        return value;
    }
};

module.exports = {
    encrypt,
    decrypt,
    ENCRYPTION_PREFIX
};
