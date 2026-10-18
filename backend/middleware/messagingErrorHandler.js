const schemaCodes = new Set(['ER_BAD_FIELD_ERROR', 'ER_NO_SUCH_TABLE', 'ER_DATA_TOO_LONG', 'MESSAGE_METADATA_NOT_PERSISTED']);
const unavailableCodes = new Set(['ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'PROTOCOL_CONNECTION_LOST', 'ER_LOCK_WAIT_TIMEOUT', 'ER_LOCK_DEADLOCK']);
module.exports = (error, req, res, next) => {
    const rawCode = error.original?.code || error.parent?.code || error.code;
    const code = typeof rawCode === 'string' && /^[A-Z0-9_]+$/.test(rawCode) ? rawCode : null;
    let status = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : 500;
    let message = status < 500 ? error.publicMessage || error.message : 'Messaging is temporarily unavailable. Please try again later.';
    if (code === 'LIMIT_FILE_SIZE') { status = 413; message = 'This attachment exceeds the maximum file size.'; }
    else if (code === 'LIMIT_FILE_COUNT') { status = 413; message = 'Only one attachment is allowed per message.'; }
    else if (code?.startsWith('LIMIT_')) { status = 400; message = 'Invalid message upload.'; }
    else if (schemaCodes.has(code)) { status = 503; message = 'Messaging storage needs a schema update. Please contact the administrator.'; }
    else if (unavailableCodes.has(code)) { status = 503; message = 'Messaging is temporarily unavailable. Please try again later.'; }
    else if (status >= 500 && error.publicMessage) message = error.publicMessage;
    const location = String(error.stack || '').match(/[/\\]([^/\\()\s]+\.js):(\d+):(\d+)/);
    console.error('[messaging-error]', { operation: `${req.method} ${req.baseUrl || ''}${req.route?.path || ''}`, name: error.name || 'Error', code, status,
        location: location ? `${location[1]}:${location[2]}:${location[3]}` : null });
    if (res.headersSent) return next(Object.assign(new Error('Messaging response could not be completed.'), { status }));
    res.removeHeader('Content-Disposition');
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(status).json({ msg: message });
};
