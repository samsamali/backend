const mongoose = require("mongoose");

const rolePermissionSchema = new mongoose.Schema(
  {
    roleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Role",
      required: true,
      index: true,
    },
    modulePermissionId: {  // Changed from permissionId to match controller
      type: mongoose.Schema.Types.ObjectId,
      ref: "ModulePermission",
      required: true,
      index: true,
    },
    is_active: {
      type: Boolean,
      default: true,  // Matches controller's forced "true" for new entries
    },
  },
  {
    timestamps: true,
  }
);

// Compound index to prevent duplicate role-permission assignments
rolePermissionSchema.index(
  { roleId: 1, modulePermissionId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      roleId: { $exists: true },
      modulePermissionId: { $exists: true },
    },
  }
);

module.exports = mongoose.model("RolePermission", rolePermissionSchema);