// backend/modules/admin/services/adminService.js

const Module = require('../models/Module');
const Permission = require('../models/Permission');
const Group = require('../models/Group');
const GroupPermission = require('../models/GroupPermission');
const Route = require('../models/Route');
const ModulePermission = require('../models/ModulePermission');
const UserModuleStatus = require('../models/UserModuleStatus');

// Create Module
const createModule = async (moduleData) => {
    const newModule = new Module(moduleData);
    return await newModule.save();
};

// Get All Modules
const getAllModules = async () => {
    return await Module.find();
};

// Update Module Status (Global for all users)
const updateModuleStatus = async (moduleId, isActive) => {
    return await Module.findByIdAndUpdate(moduleId, { is_active: isActive }, { new: true });
};

// Create Permission
const createPermission = async (permissionData) => {
    const newPermission = new Permission(permissionData);
    return await newPermission.save();
};

// Assign Module-Permission Mapping
const assignModulePermission = async (moduleId, permissionId) => {
    const mapping = new ModulePermission({ module_id: moduleId, permission_id: permissionId });
    return await mapping.save();
};

// Assign Group-Permission
const assignGroupPermission = async (groupId, permissionId) => {
    const mapping = new GroupPermission({ group_id: groupId, permission_id: permissionId });
    return await mapping.save();
};

module.exports = {
    createModule,
    getAllModules,
    updateModuleStatus,
    createPermission,
    assignModulePermission,
    assignGroupPermission
};
