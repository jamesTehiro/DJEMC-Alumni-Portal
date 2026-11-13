// routes/authRoutes.js
const router = require("express").Router();
const authController = require("../controllers/authController");
const { registrationUpload, governmentAgencyPreviewUpload } = require("../middleware/uploadMiddleware");
const bootstrapGuard = require("../middleware/bootstrapGuard");
const registrationOtp = require("../controllers/registrationOtpController");
const adminRegistration = require("../controllers/adminRegistrationController");

router.post("/registration-otp/send", registrationOtp.rateLimit("send"), registrationOtp.send);
router.post("/registration-otp/resend", registrationOtp.rateLimit("send"), registrationOtp.resend);
router.post("/registration-otp/verify", registrationOtp.rateLimit("verify"), registrationOtp.verify);
router.post("/registration-otp/status", registrationOtp.rateLimit("status"), registrationOtp.status);
router.post("/employer-registration-otp/send", registrationOtp.rateLimit("send"), registrationOtp.employerSend);
router.post("/employer-registration-otp/resend", registrationOtp.rateLimit("send"), registrationOtp.employerResend);
router.post("/employer-registration-otp/verify", registrationOtp.rateLimit("verify"), registrationOtp.employerVerify);
router.post("/employer-registration-otp/status", registrationOtp.rateLimit("status"), registrationOtp.employerStatus);
router.post("/employer-government-agency/consent-preview", registrationOtp.rateLimit("submit", ["ip"]), governmentAgencyPreviewUpload, require("../controllers/governmentAgencyController").previewConsent);
router.post("/register", registrationOtp.rateLimit("submit", ["ip"]), registrationUpload, registrationOtp.rateLimit("submit", ["email", "session"]), authController.register);
router.post("/login", authController.login);
router.post("/forgot-password", authController.forgotPassword);
router.post("/reset-password", authController.resetPassword);
// Availability contains only counts/scopes. All mutations require the setup
// secret and database-backed rate limits, even when global proxy mode is used.
// This read-only aggregate uses the existing global limiter, not the OTP store:
// registration configuration/schema must not gate discovery of existing login.
router.get("/admin-setup-status", adminRegistration.status);
router.post("/admin-setup", registrationOtp.rateLimit("submit"), bootstrapGuard, adminRegistration.create);
router.post("/admin-registration-otp/send", registrationOtp.rateLimit("send"), bootstrapGuard, adminRegistration.send);
router.post("/admin-registration-otp/resend", registrationOtp.rateLimit("send"), bootstrapGuard, adminRegistration.resend);
router.post("/admin-registration-otp/verify", registrationOtp.rateLimit("verify"), bootstrapGuard, adminRegistration.verify);
router.post("/admin-registration-otp/status", registrationOtp.rateLimit("status"), bootstrapGuard, adminRegistration.otpStatus);

module.exports = router;
