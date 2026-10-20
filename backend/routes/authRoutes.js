// routes/authRoutes.js
const router = require("express").Router();
const authController = require("../controllers/authController");
const { registrationUpload } = require("../middleware/uploadMiddleware");
const bootstrapGuard = require("../middleware/bootstrapGuard");
const registrationOtp = require("../controllers/registrationOtpController");

router.post("/registration-otp/send", registrationOtp.rateLimit("send"), registrationOtp.send);
router.post("/registration-otp/resend", registrationOtp.rateLimit("send"), registrationOtp.resend);
router.post("/registration-otp/verify", registrationOtp.rateLimit("verify"), registrationOtp.verify);
router.post("/registration-otp/status", registrationOtp.rateLimit("status"), registrationOtp.status);
router.post("/register", registrationOtp.rateLimit("submit", ["ip"]), registrationUpload, registrationOtp.rateLimit("submit", ["email", "session"]), authController.register);
router.post("/login", authController.login);
router.post("/forgot-password", authController.forgotPassword);
router.post("/reset-password", authController.resetPassword);
router.get("/admin-setup-status", bootstrapGuard, authController.getAdminSetupStatus);
router.post("/admin-setup", bootstrapGuard, authController.setupAdmin);

module.exports = router;
