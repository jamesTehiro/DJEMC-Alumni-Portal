// A scoped app disables Express's automatic ETags for private bytes AND JSON
// errors, without changing caching on public images or unrelated APIs.
const router = require("express")();
const authMiddleware = require("../middleware/authMiddleware");
const fileController = require("../controllers/fileController");
const errorHandler = require("../middleware/errorHandler");

router.disable("etag");
router.use((req, res, next) => {
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.vary("Authorization");
    // These resources are deliberately never reused from a cache. Ignore
    // stale validators (including '*') before either Express or sendFile can
    // turn a successful authorized response into a body-less 304.
    delete req.headers["if-none-match"];
    delete req.headers["if-modified-since"];
    next();
});
router.use(authMiddleware);
router.get("/secure/:token", fileController.getSecureStoredFile);
router.get("/:folder/:fileName", fileController.getSecureFile);
router.use((error, req, res, next) => {
    // sendFile can fail after a successful filesystem check. Never pass its
    // raw ENOENT/EACCES error (which includes the internal path) to clients/logs.
    const status = [400, 403, 404, 502, 503].includes(error.status) ? error.status : 500;
    const message = status === 404 ? "File not found." : status === 400 ? "Invalid stored file reference."
        : status === 403 ? "You are not allowed to access this file."
            : status >= 502 ? "File storage is temporarily unavailable. Please try again later." : "File could not be retrieved.";
    return errorHandler(Object.assign(new Error(message), { status, publicMessage: message }), req, res, next);
});

module.exports = router;
