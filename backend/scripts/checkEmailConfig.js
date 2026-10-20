const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });
const email = require("../utils/email");
const { safeEmailError } = require("../utils/emailDiagnostics");

// --verify validates the selected transport only; it never sends or changes queue jobs.
(async () => {
    email.logConfiguration();
    try {
        email.validateConfiguration();
        if (process.argv.includes("--verify")) {
            await email.verify();
            console.log("[email] local transport check passed; no email sent; API authentication and inbox delivery are not verified");
        }
    } catch (error) {
        console.error("[email] check failed", safeEmailError(error));
        process.exitCode = 1;
    }
})();
