const multer = require("multer");
const { MAX_CSV_BYTES } = require("../utils/alumniRecordsCsv");

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_CSV_BYTES, files: 1, fields: 1, parts: 3, fieldSize: 20 },
    fileFilter: (_req, file, callback) => {
        const allowedMime = ["text/csv", "application/csv", "text/plain", "application/vnd.ms-excel", "application/octet-stream"];
        if (!/\.csv$/i.test(file.originalname) || (file.mimetype && !allowedMime.includes(file.mimetype))) {
            return callback(Object.assign(new Error("Choose a UTF-8 CSV file (.csv)."), { status: 400 }));
        }
        callback(null, true);
    }
}).single("file");

module.exports = (req, res, next) => upload(req, res, (error) => {
    if (!error) return next();
    const oversized = error.code === "LIMIT_FILE_SIZE";
    return res.status(oversized ? 413 : error.status || 400).json({
        msg: oversized ? "CSV files must be 2 MB or smaller." : error.message || "Upload one CSV file and a preview/import mode."
    });
});
