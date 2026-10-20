// Never log raw delivery/SQL errors: they can contain recipients, tokens or credentials.
const safeEmailError = (error) => {
    const codes = new Set(["EAUTH", "ECONNECTION", "ETIMEDOUT", "ESOCKET", "EDNS", "ECONNREFUSED", "ECONNRESET", "EENVELOPE", "EMESSAGE", "ETLS", "EMAIL_CONFIG", "EMAIL_RECIPIENT", "EMAIL_MESSAGE", "EMAIL_API", "EMAIL_NETWORK", "EMAIL_RESPONSE", "EMAIL_AMBIGUOUS", "EMAIL_STATE", "EMAIL_EXHAUSTED", "ER_BAD_FIELD_ERROR", "ER_NO_SUCH_TABLE", "ER_DUP_ENTRY", "ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"]);
    const code = error?.original?.code || error?.parent?.code || error?.code;
    return {
        code: codes.has(code) ? code : "EMAIL_ERROR",
        responseCode: Number.isInteger(error?.responseCode) ? error.responseCode : undefined,
        ...(error?.deliveryUnknown === true ? { deliveryUnknown: true } : {})
    };
};
// Brevo/SMTP message identifiers are useful for provider-log reconciliation.
// Reject whitespace, controls and unbounded upstream values before logging.
const safeMessageId = value => typeof value === "string" && /^[a-z0-9._@:+<>-]{1,512}$/i.test(value) ? value : undefined;

const requiresDeliveryReview = lastError => {
    let error;
    try { error = typeof lastError === "string" ? JSON.parse(lastError) : lastError; } catch { return true; }
    if (!error || error.deliveryUnknown === true) return true;
    if (["EMAIL_CONFIG", "EMAIL_RECIPIENT", "EMAIL_MESSAGE", "EAUTH", "EDNS", "ECONNREFUSED", "ECONNECTION", "ETLS"].includes(error.code)) return false;
    if (["EMAIL_API", "EENVELOPE", "EMESSAGE"].includes(error.code)) {
        return !Number.isInteger(error.responseCode) || error.responseCode === 408 || error.responseCode < 400 ||
            (error.code === "EMAIL_API" && error.responseCode >= 500) || error.responseCode >= 600;
    }
    // Legacy errors without a definite rejection remain unknown, not unsent.
    return true;
};
module.exports = { safeEmailError, safeMessageId, requiresDeliveryReview };
