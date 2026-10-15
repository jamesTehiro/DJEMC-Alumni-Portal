const router = require("express").Router();
const auth = require("../middleware/authMiddleware");
const controller = require("../controllers/membershipController");

router.use(auth);
router.get("/access", controller.getAccess);
router.get("/me", controller.getMyApplication);
router.put("/me/draft", controller.saveDraft);
router.post("/me/submit", controller.submitApplication);
router.get("/me/document", controller.getMyDocument);
router.get("/me/pdf", controller.getMyPdf);
router.get("/admin", controller.listApplications);
router.get("/admin/:id/document", controller.getApplicationDocument);
router.get("/admin/:id/pdf", controller.getApplicationPdf);
router.get("/admin/:id", controller.getApplication);
module.exports = router;
