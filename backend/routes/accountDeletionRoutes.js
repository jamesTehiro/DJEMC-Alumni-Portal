const router = require('express').Router();
const auth = require('../middleware/authMiddleware');
const role = require('../middleware/roleMiddleware');
const scope = require('../middleware/adminScopeMiddleware');
const controller = require('../controllers/accountDeletionController');
// This public, nonsecret marker is set only on registered deletion routes,
// before authentication. A 401 alone cannot prove these handlers are deployed.
const revision = (_req, res, next) => { res.setHeader('X-Account-Deletion-API', 'v1'); next(); };
for (const accountRole of ['alumni', 'employer']) {
    const guards = [revision, auth, role('admin'), scope(accountRole)];
    router.get(`/${accountRole}/users/:userId/deletion-impact`, ...guards, controller[accountRole === 'alumni' ? 'previewAlumni' : 'previewEmployer']);
    router.delete(`/${accountRole}/users/:userId`, ...guards, controller[accountRole === 'alumni' ? 'deleteAlumni' : 'deleteEmployer']);
}
module.exports = router;
