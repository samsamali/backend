const mongoose = require("mongoose");

const modulePermissionSchema = new mongoose.Schema(
  {
    moduleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Module",
      required: true,
    },
    permissionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Permission",
      required: true,
    },
      is_active: {
        type: Boolean,
        default: false,
      },
  },
  { timestamps: true }
);

module.exports = mongoose.model("ModulePermission", modulePermissionSchema);
