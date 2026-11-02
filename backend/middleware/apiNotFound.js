module.exports = (_req, res) => res.status(404).json({
    code: 'API_ROUTE_NOT_FOUND',
    msg: 'API endpoint not found. Verify the API URL and deployed backend version.'
});
