const roleService = require("../services/roleService");
const Role = require("../models/Role");
const RolePermission = require("../models/role-permissions");
const ModulePermission = require("../../../modules/admin/models/module-permissions");

exports.createRole = async (req, res) => {
  try {
    const {
      name,
      description,
      is_default = false,
      modulePermissions = [],
    } = req.body;

    // Step 1: Create the role
    const newRole = await Role.create({
      name,
      description,
      is_default,
    });

    let finalModulePermissions = modulePermissions;

    // If the role is named "super-admin", assign ALL module permissions automatically
    if (name.toLowerCase() === "super-admin") {
      const allModulePermissions = await ModulePermission.find();
      finalModulePermissions = allModulePermissions.map((doc) => ({
        moduleId: doc.moduleId,
        permissionId: doc.permissionId,
      }));
    }

    // Step 2: Process modulePermissions (either provided or all if super-admin)
    if (finalModulePermissions.length > 0) {
      const modulePermissionDocs = await ModulePermission.find({
        $or: finalModulePermissions.map(({ moduleId, permissionId }) => ({
          moduleId,
          permissionId,
        })),
      });

      const validPermissions = finalModulePermissions.filter((mp) =>
        modulePermissionDocs.some(
          (doc) =>
            doc.moduleId.equals(mp.moduleId) &&
            doc.permissionId.equals(mp.permissionId)
        )
      );

      if (validPermissions.length !== finalModulePermissions.length) {
        const missing = finalModulePermissions.filter(
          (mp) =>
            !modulePermissionDocs.some(
              (doc) =>
                doc.moduleId.equals(mp.moduleId) &&
                doc.permissionId.equals(mp.permissionId)
            )
        );
        console.warn(
          `Ignoring invalid ModulePermissions: ${JSON.stringify(missing)}`
        );
      }

      const existingRolePermissions = await RolePermission.find({
        roleId: newRole._id,
        modulePermissionId: { $in: modulePermissionDocs.map((doc) => doc._id) },
      });

      const newRolePermissions = modulePermissionDocs
        .filter(
          (doc) =>
            !existingRolePermissions.some((rp) =>
              rp.modulePermissionId.equals(doc._id)
            )
        )
        .map((doc) => ({
          roleId: newRole._id,
          modulePermissionId: doc._id,
          is_active: true,
        }));

      if (newRolePermissions.length > 0) {
        await RolePermission.insertMany(newRolePermissions);
      }
    }

    return res.status(201).json({
      success: true,
      message:
        name.toLowerCase() === "super-admin"
          ? "Super-admin role created with all module permissions."
          : finalModulePermissions.length > 0
          ? "Role created with module permissions (duplicates ignored)"
          : "Basic role created (no permissions assigned)",
      data: {
        role: newRole,
        permissionCount: finalModulePermissions.length,
      },
    });
  } catch (error) {
    console.error("Role creation failed:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
};

exports.listRoles = async (req, res) => {
  try {
    const roles = await Role.aggregate([
      {
        $lookup: {
          from: "rolepermissions",
          localField: "_id",
          foreignField: "roleId",
          as: "rolePermissions",
        },
      },
      {
        $lookup: {
          from: "modulepermissions",
          localField: "rolePermissions.modulePermissionId",
          foreignField: "_id",
          as: "modulePermissions",
        },
      },
      {
        $lookup: {
          from: "modules",
          localField: "modulePermissions.moduleId",
          foreignField: "_id",
          as: "modules",
        },
      },
      {
        $lookup: {
          from: "permissions",
          localField: "modulePermissions.permissionId",
          foreignField: "_id",
          as: "permissions",
        },
      },
      {
        $project: {
          _id: 1,
          name: 1,
          description: 1,
          is_default: 1,
          is_super_admin: 1,
          createdAt: 1,
          updatedAt: 1,
          permissions: {
            $map: {
              input: "$modulePermissions",
              as: "mp",
              in: {
                moduleId: "$$mp.moduleId",
                moduleName: {
                  $arrayElemAt: [
                    "$modules.name",
                    { $indexOfArray: ["$modules._id", "$$mp.moduleId"] },
                  ],
                },
                permissionId: "$$mp.permissionId",
                permissionName: {
                  $arrayElemAt: [
                    "$permissions.name",
                    {
                      $indexOfArray: ["$permissions._id", "$$mp.permissionId"],
                    },
                  ],
                },
                is_active: {
                  $arrayElemAt: [
                    "$rolePermissions.is_active",
                    {
                      $indexOfArray: [
                        "$rolePermissions.modulePermissionId",
                        "$$mp._id",
                      ],
                    },
                  ],
                },
              },
            },
          },
        },
      },
    ]);

    res.status(200).json({
      success: true,
      data: roles,
    });
  } catch (error) {
    console.error("Error fetching roles with permissions:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching roles",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// Update role
exports.updateRole = async (req, res) => {
  try {
    const { id } = req.params;
    const { modulePermissions = [] } = req.body; // Expect array of {moduleId, permissionId}

    // 1. Validate Role exists
    const role = await Role.findById(id);
    if (!role) {
      return res.status(404).json({ message: "Role not found" });
    }

    // 2. Get all existing permissions for this role
    const existingRolePermissions = await RolePermission.find({ roleId: id });

    // 3. Process new permissions from request
    const processedPermissions = [];
    const ignoredDuplicates = [];
    const permissionsToDeactivate = [...existingRolePermissions]; // Start with all existing

    for (const { moduleId, permissionId } of modulePermissions) {
      // 3a. Validate ModulePermission exists
      const modulePermission = await ModulePermission.findOne({
        moduleId,
        permissionId,
      });

      if (!modulePermission) {
        console.warn(
          `Skipping invalid ModulePermission: moduleId=${moduleId}, permissionId=${permissionId}`
        );
        continue;
      }

      // 3b. Check if permission already exists for this role
      const existingIndex = permissionsToDeactivate.findIndex((rp) =>
        rp.modulePermissionId.equals(modulePermission._id)
      );

      if (existingIndex > -1) {
        // Permission exists - update to active and remove from deactivation list
        const existing = permissionsToDeactivate[existingIndex];
        if (!existing.is_active) {
          existing.is_active = true;
          await existing.save();
          processedPermissions.push(existing);
        } else {
          ignoredDuplicates.push(modulePermission._id);
        }
        permissionsToDeactivate.splice(existingIndex, 1);
        continue;
      }

      // 3c. Create new RolePermission if it doesn't exist
      const newRolePerm = await RolePermission.create({
        roleId: id,
        modulePermissionId: modulePermission._id,
        is_active: true,
      });
      processedPermissions.push(newRolePerm);
    }

    // 4. Deactivate any permissions not included in the request
    const deactivatedPermissions = [];
    for (const rolePerm of permissionsToDeactivate) {
      if (rolePerm.is_active) {
        rolePerm.is_active = false;
        await rolePerm.save();
        deactivatedPermissions.push(rolePerm);
      }
    }

    // 5. Return response
    return res.status(200).json({
      success: true,
      message: "Module permissions processed",
      added: processedPermissions.length,
      updated: deactivatedPermissions.length,
      ignoredDuplicates: ignoredDuplicates.length,
      data: {
        processedPermissions,
        deactivatedPermissions,
        ignoredDuplicates,
      },
    });
  } catch (error) {
    console.error("Error updating role permissions:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// Delete Role by ID
exports.deleteRole = async (req, res) => {
  try {
    const { id } = req.params;

    // Step 1: Delete the role
    const deletedRole = await Role.findByIdAndDelete(id);
    if (!deletedRole) {
      return res.status(404).json({ message: "Role not found" });
    }

    // Step 2: Delete all related RolePermissions
    await RolePermission.deleteMany({ roleId: id });

    res.status(200).json({
      message: "Role and associated permissions deleted successfully",
      role: deletedRole,
    });
  } catch (error) {
    console.error("Error deleting role:", error);
    res.status(500).json({
      message: "Error deleting role",
      error: error.message,
    });
  }
};