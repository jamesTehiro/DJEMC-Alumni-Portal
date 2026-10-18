module.exports = (req, res, next) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.vary('Authorization');
    delete req.headers['if-none-match'];
    delete req.headers['if-modified-since'];
    next();
};
