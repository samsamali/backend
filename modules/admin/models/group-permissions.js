const mongoose = require("mongoose");

const GroupPermissionSchema = new mongoose.Schema({
  groupId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Group",
    required: true
  },
  groupName: {
    type: String,
    required: true
  },
  permissions: [
    {
      permissionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Permission",
        required: true
      },
      permissionName: {
        type: String,
        required: false
      },
      permissionCode: {
        type: String,
        required: false
      },
      isActive: {
        type: Boolean,
        default: true
      }
    }
  ],
}, { timestamps: true });

module.exports = mongoose.model("GroupPermission", GroupPermissionSchema);
