const express = require('express');
const router = express.Router();
const roleController = require('../controllers/roleController');
const superAdminSyncController = require('../controllers/superAdminSyncController');
const { verifyToken } = require('../../auth/middlewares/authMiddleware');
const permissionMiddleware = require('../../auth/middlewares/permissionMiddleware');


// POST /api/roles/create
router.post(
    '/create', 
    verifyToken, 
    permissionMiddleware('role-create'),
    roleController.createRole
);

// GET /api/roles/list
router.get(
    '/list', 
    verifyToken, 
    permissionMiddleware('role-list'),
    roleController.listRoles
);

// update role
router.put(
    '/update/:id',
    verifyToken, 
    permissionMiddleware('role-update'),
    roleController.updateRole
);

// DELETE /api/roles/delete/:id
router.delete(
    '/delete/:id', 
    verifyToken, 
    permissionMiddleware('role-delete'),
    roleController.deleteRole
);

// POST /api/roles/sync-super-admin-permissions
router.post(
    '/sync-super-admin-permissions', 
    verifyToken, 
    permissionMiddleware('super_admin_sync'), 
    superAdminSyncController.syncSuperAdminPermissions
);

module.exports = router;
