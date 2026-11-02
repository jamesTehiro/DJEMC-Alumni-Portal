const db = require('../models');
const service = require('../services/accountDeletion').createAccountDeletion({ db });
const handler = (role, method) => async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    try {
        const result = await service[method]({ actor: req.user, role, id: Number(req.params.userId),
            confirmation: req.body?.confirmation, confirmationToken: req.body?.confirmationToken, ip: req.ip });
        return res.json(result);
    } catch (error) {
        if (!error.status) console.error('[ACCOUNT_DELETION_FAILED]', { kind: error.name || 'Error' });
        return res.status(error.status || 500).json({ msg: error.status ? error.message : 'Account deletion could not be completed. No account deletion was committed. Refresh the preview before retrying.' });
    }
};
exports.previewAlumni = handler('alumni', 'preview');
exports.deleteAlumni = handler('alumni', 'remove');
exports.previewEmployer = handler('employer', 'preview');
exports.deleteEmployer = handler('employer', 'remove');
