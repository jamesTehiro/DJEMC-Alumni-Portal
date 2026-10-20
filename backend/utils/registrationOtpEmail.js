const sendEmail = require("./email");

// Registration uses the existing Brevo API adapter and verified sender.
// Other notification transports retain their existing behavior.
module.exports = async (to, subject, text, options) => {
    if (sendEmail.validateConfiguration().provider !== "brevo") {
        const error = new Error("Registration email requires the configured Brevo transport.");
        error.code = "EMAIL_CONFIG";
        throw error;
    }
    return sendEmail(to, subject, text, options);
};
