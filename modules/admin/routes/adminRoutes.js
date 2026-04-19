const express = require("express");
const router = express.Router();
const groupController = require("../controllers/groupController");
const moduleController = require("../controllers/moduleController");
const permissionController = require("../controllers/permissionController");
const userModuleStatusController = require("../controllers/userModuleStatusController");
const { verifyToken } = require("../../auth/middlewares/authMiddleware");
const permissionMiddleware = require("../../auth/middlewares/permissionMiddleware");


//All permissions related routes

router.post(
  "/permissions",
  verifyToken,
  permissionMiddleware('permission_create'),
  permissionController.createPermission
);
router.get(
  "/permissions",
  verifyToken,
  permissionMiddleware('permission_list'),
  permissionController.getAllPermissions
);
router.delete(
  "/permissions/:id",
  verifyToken,
  permissionMiddleware('permission_delete'),
  permissionController.deletePermission
);
router.put(
  "/permissions/:id",
  verifyToken,
  permissionMiddleware('permission_update'),
  permissionController.updatePermission
);

// All group related routes

router.post(
  "/groups",
  verifyToken,
  permissionMiddleware('group_create'),
  groupController.createGroup
);
router.get(
  "/groups", 
  verifyToken, 
  permissionMiddleware('group_list'),
  groupController.getAllGroups
);
router.put(
  "/groups/:id",
   verifyToken,
  permissionMiddleware('group_update'),
   groupController.updateGroup
  );
router.delete(
  "/groups/:id",
  verifyToken,
  permissionMiddleware('group_delete'),
  groupController.deleteGroup
);


// All module related routes

router.post(
  "/modules",
  verifyToken,
  permissionMiddleware('module_create'), 
  moduleController.createModule
);
router.get(
  "/modules",
  verifyToken,
  permissionMiddleware('module_list'),
  moduleController.getAllModules
);
router.delete(
  "/modules/:id",
  verifyToken,
  permissionMiddleware('module_delete'),
  moduleController.deleteModule
);
router.put(
  "/modules/:id",
  verifyToken,
  permissionMiddleware('module_update'),
  moduleController.updateModule
);

// All user module status related routes

router.put(
  "/user-module-status",
  verifyToken,
  permissionMiddleware('user_module_status_update'),
  userModuleStatusController.updateUserModuleStatus
);
router.get(
  "/user-module-status",
  verifyToken,
  permissionMiddleware('user_module_status_list'),
  userModuleStatusController.getAllUserModuleStatus
);
router.delete(
  "/user-module-status",
  verifyToken,
  permissionMiddleware('user_module_status_delete'),
  userModuleStatusController.deleteUserModuleStatus
);

// Export the router
module.exports = router;
