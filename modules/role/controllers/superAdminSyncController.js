// superAdminSyncController.js
const Role = require('../models/Role');
const RolePermission = require('../models/role-permissions');
const ModulePermission = require('../../admin/models/module-permissions');

// Sync all module permissions to super-admin role
exports.syncSuperAdminPermissions = async (req, res) => {
  try {
    // Find super-admin role
    const superAdminRole = await Role.findOne({ name: 'super-admin' });
    if (!superAdminRole) {
      return res.status(404).json({ success: false, message: 'Super-admin role not found.' });
    }

    // Get all module permissions
    const allModulePermissions = await ModulePermission.find();
    const allModulePermissionIds = allModulePermissions.map(mp => mp._id);

    // Find existing role-permissions for super-admin
    const existingRolePermissions = await RolePermission.find({
      roleId: superAdminRole._id,
      modulePermissionId: { $in: allModulePermissionIds }
    });
    const existingIds = existingRolePermissions.map(rp => rp.modulePermissionId.toString());

    // Find missing permissions
    const missingModulePermissionIds = allModulePermissionIds.filter(id => !existingIds.includes(id.toString()));

    // Insert missing permissions
    const newRolePermissions = missingModulePermissionIds.map(modulePermissionId => ({
      roleId: superAdminRole._id,
      modulePermissionId,
      is_active: true
    }));
    if (newRolePermissions.length > 0) {
      await RolePermission.insertMany(newRolePermissions);
    }

    // Activate any inactive permissions
    await RolePermission.updateMany({
      roleId: superAdminRole._id,
      modulePermissionId: { $in: allModulePermissionIds },
      is_active: false
    }, { is_active: true });

    return res.status(200).json({
      success: true,
      message: 'Super-admin permissions synced.',
      added: newRolePermissions.length
    });
  } catch (error) {
    console.error('Super-admin sync error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
  }
};
