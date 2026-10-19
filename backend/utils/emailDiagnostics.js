// Never log raw delivery/SQL errors: they can contain recipients, tokens or credentials.
const safeEmailError = (error) => {
    const codes = new Set(["EAUTH", "ECONNECTION", "ETIMEDOUT", "ESOCKET", "EDNS", "ECONNREFUSED", "ECONNRESET", "EENVELOPE", "EMESSAGE", "ETLS", "EMAIL_CONFIG", "EMAIL_API", "EMAIL_NETWORK", "EMAIL_RESPONSE", "EMAIL_AMBIGUOUS", "EMAIL_STATE", "EMAIL_EXHAUSTED", "ER_BAD_FIELD_ERROR", "ER_NO_SUCH_TABLE", "ER_DUP_ENTRY", "ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"]);
    const code = error?.original?.code || error?.parent?.code || error?.code;
    return {
        code: codes.has(code) ? code : "EMAIL_ERROR",
        responseCode: Number.isInteger(error?.responseCode) ? error.responseCode : undefined
    };
};
module.exports = { safeEmailError };
