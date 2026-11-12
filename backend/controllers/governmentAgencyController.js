"use strict";

const { generateConsentPdf, createPreviewToken } = require("../services/governmentAgencyRegistration");

exports.previewConsent = async (req, res, next) => {
    try {
        const details = require("../services/governmentAgencyRegistration").parseDetails(req.body.details);
        const signature = req.files?.government_signature?.[0];
        const seal = req.files?.government_seal?.[0] || null;
        if (!signature) return res.status(400).json({ msg: "An authorized representative signature image is required." });
        const pdf = await generateConsentPdf(details, signature, seal);
        res.setHeader("Cache-Control", "private, no-store");
        res.setHeader("X-Content-Type-Options", "nosniff");
        return res.json({
            pdf_base64: pdf.toString("base64"),
            preview_token: createPreviewToken({ details, signature, seal, pdf })
        });
    } catch (error) {
        return next(error);
    }
};
