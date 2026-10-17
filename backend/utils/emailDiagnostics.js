// Never log raw delivery/SQL errors: they can contain recipients, tokens or credentials.
const safeEmailError = (error) => {
    const codes = new Set(["EAUTH", "ECONNECTION", "ETIMEDOUT", "ESOCKET", "EDNS", "ECONNREFUSED", "ECONNRESET", "EENVELOPE", "EMESSAGE", "ETLS", "EMAIL_CONFIG", "EMAIL_API", "EMAIL_NETWORK", "EMAIL_RESPONSE"]);
    return {
        code: codes.has(error?.code) ? error.code : "EMAIL_ERROR",
        responseCode: Number.isInteger(error?.responseCode) ? error.responseCode : undefined
    };
};
module.exports = { safeEmailError };
