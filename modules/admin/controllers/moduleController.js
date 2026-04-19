const mongoose = require("mongoose");
const Module = require("../models/Module");
const ModulePermission = require("../models/module-permissions");
const Permission = require("../models/Permission");

const createModule = async (req, res) => {
  try {
    const {
      name,
      description,
      route_path,
      icon,
      is_category,
      is_active,
      userId,
      parent_id,
      order,
      permissionIds = [],
    } = req.body;

    // Check duplicate order
    const existing = await Module.findOne({ order });
    if (existing) {
      return res.status(400).json({ message: "Order number already in use" });
    }

    // Fetch only permissions sent from frontend
    const permissionDocs = await Permission.find({
      _id: { $in: permissionIds },
    });

    // Create permissions array for module document
    const permissionsArray = permissionDocs.map((perm) => ({
      _id: perm._id,
      name: perm.name,
      status: true,
    }));

    // Create module
    const newModule = new Module({
      name,
      description,
      route_path,
      icon,
      is_category,
      is_active,
      userId,
      parent_id: parent_id || null,
      order,
      permissions: permissionsArray,
    });

    await newModule.save();

    // Save only selected permissions in ModulePermission collection
    for (const perm of permissionDocs) {
      await ModulePermission.create({
        moduleId: newModule._id,
        permissionId: perm._id,
        is_active: true,
      });
    }

    res.status(201).json({
      message: "Module created",
      module: newModule,
    });

  } catch (error) {
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

const getAllModules = async (req, res) => {
  try {
    // Remove all role-based filtering - always get ALL active modules
    let filter = { is_active: true };

    // Get all modules with filtering
    const modules = await Module.find(filter).sort({ order: 1 });

    // Get all ACTIVE module-permission relationships
    const modulePermissions = await ModulePermission.find({ is_active: true })
      .populate({
        path: "permissionId",
        select: "name _id code", // Also get permission code
      })
      .populate({
        path: "moduleId",
        select: "_id", // We only need the module reference
      });

    // Group permissions by module
    const permissionsByModule = {};
    modulePermissions.forEach((mp) => {
      const moduleId = mp.moduleId?._id?.toString();
      if (moduleId && mp.permissionId) {
        if (!permissionsByModule[moduleId]) {
          permissionsByModule[moduleId] = [];
        }
        permissionsByModule[moduleId].push({
          _id: mp.permissionId._id,
          name: mp.permissionId.name,
          code: mp.permissionId.code, // Include permission code
        });
      }
    });

    // Combine modules with their permissions
    const modulesWithPermissions = modules.map((module) => ({
      ...module.toObject(),
      permissions: permissionsByModule[module._id.toString()] || [],
    }));

    res.status(200).json(modulesWithPermissions);
  } catch (error) {
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

const updateModule = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    const { permissionIds, ...moduleFields } = updateData;

    // ✅ name is now included in moduleFields so it gets updated too
    // moduleFields contains: name, description, route_path, icon,
    //                        is_category, is_active, parent_id, order

    // 1. UPDATE THE MODULE DOCUMENT (including name now)
    const updatedModule = await Module.findByIdAndUpdate(
      id,
      {
        ...moduleFields,
        updated_at: new Date(),
      },
      { new: true, runValidators: true }
    );

    if (!updatedModule) {
      return res.status(404).json({ message: "Module not found" });
    }

    // 2. UPDATE PERMISSIONS (only if permissionIds array is provided)
    if (permissionIds && Array.isArray(permissionIds) && permissionIds.length > 0) {

      const validPermissionDocs = await Permission.find({
        '_id': { $in: permissionIds }
      }).select('_id name code');

      const validPermissionIds = validPermissionDocs.map(p => p._id.toString());
      const validIdSet = new Set(validPermissionIds);

      const existingModulePermissions = await ModulePermission.find({ moduleId: id });

      const existingPermIdSet = new Set();

      for (const relation of existingModulePermissions) {
        const permIdStr = relation.permissionId.toString();
        existingPermIdSet.add(permIdStr);

        if (validIdSet.has(permIdStr)) {
          if (relation.is_active !== true) {
            relation.is_active = true;
            await relation.save();
          }
        } else {
          if (relation.is_active !== false) {
            relation.is_active = false;
            await relation.save();
          }
        }
      }

      // Create new ModulePermission entries for newly added permissions
      for (const newPermId of permissionIds) {
        if (!mongoose.Types.ObjectId.isValid(newPermId)) continue;
        if (!existingPermIdSet.has(newPermId.toString())) {
          await ModulePermission.create({
            moduleId: id,
            permissionId: newPermId,
            is_active: true,
          });
        }
      }

      updatedModule.permissions = validPermissionDocs.map(p => ({
        _id: p._id,
        name: p.name,
        code: p.code,
      }));
      await updatedModule.save();

    } else if (permissionIds && Array.isArray(permissionIds) && permissionIds.length === 0) {
      // Empty array passed — deactivate all permissions
      await ModulePermission.updateMany({ moduleId: id }, { is_active: false });
      updatedModule.permissions = [];
      await updatedModule.save();
    }

    const finalPermissions = await ModulePermission.find({
      moduleId: id,
      is_active: true,
    }).populate('permissionId', 'name code');

    return res.status(200).json({
      message: "Module updated successfully",
      module: updatedModule,
      activePermissions: finalPermissions,
    });

  } catch (err) {
    console.error("Error updating module:", err);
    return res.status(500).json({ message: "Server error", error: err.message });
  }
};

const deleteModule = async (req, res) => {
  try {
    const { id } = req.params;

    const module = await Module.findById(id);
    if (!module) return res.status(404).json({ message: "Module not found" });

    await ModulePermission.deleteMany({ moduleId: id });
    await Module.findByIdAndDelete(id);

    res.status(200).json({ message: "Module and its permissions deleted" });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

module.exports = {
  createModule,
  getAllModules,
  updateModule,
  deleteModule
};