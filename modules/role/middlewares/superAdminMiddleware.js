const Role = require("../models/Role");
const ModulePermission = require("../../../modules/admin/models/module-permissions");
const RolePermission = require("../models/role-permissions");



const grantAllToSuperAdmin = async (req, res, next) => {
  try {
    // Find super-admin role
    const superAdminRole = await Role.findOne({ name: "super-admin" });
    
    if (!superAdminRole) {
      return next(); // No super-admin role exists yet
    }

    // Get the newly created module/permission from request body
    const { moduleId, permissionId } = req.body;
    
    if (moduleId && permissionId) {
      // This is a module-permission relationship being created
      const modulePermission = await ModulePermission.findOne({
        moduleId,
        permissionId
      });
      
      if (modulePermission) {
        // Check if super-admin already has this permission
        const existingPermission = await RolePermission.findOne({
          roleId: superAdminRole._id,
          modulePermissionId: modulePermission._id
        });
        
        if (!existingPermission) {
          // Grant this permission to super-admin
          await RolePermission.create({
            roleId: superAdminRole._id,
            modulePermissionId: modulePermission._id,
            is_active: true
          });
        }
      }
    }
    
    next();
  } catch (error) {
    console.error("Error in superAdminMiddleware:", error);
    next(error);
  }
};


const initializeSuperAdminPermissions = async () => {
  try {
    // Find or create super-admin role
    let superAdminRole = await Role.findOne({ name: "super-admin" });
    
    if (!superAdminRole) {
      superAdminRole = await Role.create({
        name: "super-admin",
        description: "Super Administrator with full system access",
        is_default: false
      });
      console.log("Super-admin role created during initialization");
    }

    // Get all module permissions
    const allModulePermissions = await ModulePermission.find();
    
    // For each module permission, ensure super-admin has access
    for (const mp of allModulePermissions) {
      const existingPermission = await RolePermission.findOne({
        roleId: superAdminRole._id,
        modulePermissionId: mp._id
      });
      
      if (!existingPermission) {
        await RolePermission.create({
          roleId: superAdminRole._id,
          modulePermissionId: mp._id,
          is_active: true
        });
      }
    }
    
    console.log("Super-admin permissions initialized successfully");
  } catch (error) {
    console.error("Error initializing super-admin permissions:", error);
  }
};

module.exports = {
  grantAllToSuperAdmin,
  initializeSuperAdminPermissions
};