module.exports = (req, res, next) => {
    const shouldLogRequests =
        process.env.LOG_REQUESTS === "true" ||
        (process.env.NODE_ENV !== "production" && process.env.LOG_REQUESTS !== "false");

    if (!shouldLogRequests) {
        return next();
    }

    const start = Date.now();
    res.on("finish", () => {
        const duration = Date.now() - start;
        // Membership search/filter queries may contain private names and email addresses.
        const loggedUrl = /^\/api\/membership(?:\/|\?|$)/i.test(req.originalUrl)
            ? req.originalUrl.split("?")[0]
            : req.originalUrl;
        // eslint-disable-next-line no-console
        console.log(
            `[${new Date().toISOString()}] ${req.method} ${loggedUrl} ${res.statusCode} - ${duration}ms`
        );
    });
    next();
};
