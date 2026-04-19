const Group = require("../models/Group");
const GroupPermission = require("../models/group-permissions");
const Permission = require("../models/Permission");

// ================================
// CREATE GROUP + ASSIGN PERMISSIONS
// ================================

const createGroup = async (req, res) => {
  try {
    const { groupName, description, permissions = [] } = req.body;

    if (!groupName) return res.status(400).json({ message: "Group name required" });

    // 1️⃣ Create group
    const newGroup = await Group.create({ groupName, description });


    let finalPermissions = [];
    if (permissions.length > 0) {
      // Fetch permission codes from DB
      const fetchedPermissions = await Permission.find({ _id: { $in: permissions } });
      if (fetchedPermissions.length === 0) {
        return res.status(400).json({ message: "Invalid permission IDs" });
      }
      // Map ID → Code (always store both)
      finalPermissions = fetchedPermissions.map(p => ({
        permissionId: p._id,
        permissionCode: p.code,
        isActive: true
      }));
    }
    // 2️⃣ Save in GroupPermission collection
    await GroupPermission.create({
      groupId: newGroup._id,
      groupName: newGroup.groupName,
      permissions: finalPermissions
    });

    return res.status(201).json({
      message: "Group created successfully",
      group: newGroup
    });

  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
};


// ================================
// GET ALL GROUPS
// ================================

const getAllGroups = async (req, res) => {
  try {
    const groups = await Group.find();

    // Fetch permissions for each group
    const groupIds = groups.map((group) => group._id);
    const groupPermissions = await GroupPermission.find({ groupId: { $in: groupIds } });

    // Map permissions to their respective groups
    const groupsWithPermissions = groups.map((group) => {
      const permissions = groupPermissions.find((gp) => gp.groupId.toString() === group._id.toString())?.permissions || [];
      return {
        ...group.toObject(),
        permissions,
      };
    });

    res.status(200).json(groupsWithPermissions);
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

// ================================
// UPDATE GROUP + UPDATE PERMISSIONS
// ================================

const updateGroup = async (req, res) => {
  try {
    const { id } = req.params;
    const { groupName, description, permissions } = req.body;

    const group = await Group.findById(id);
    if (!group) return res.status(404).json({ message: "Group not found" });

    // Fetch existing groupPermission
    const existingGroupPermission = await GroupPermission.findOne({ groupId: id });

    let isGroupUpdated = false;
    let isPermissionsUpdated = false;

    // ===============================
    // 1) UPDATE GROUP DETAILS ONLY IF CHANGED
    // ===============================
    if (
      (groupName && groupName !== group.groupName) ||
      (description && description !== group.description)
    ) {
      if (groupName) group.groupName = groupName;
      if (description) group.description = description;

      await group.save();
      isGroupUpdated = true;
    }

    // ===============================
    // 2) UPDATE PERMISSIONS ONLY IF DIFFERENT
    // ===============================
    if (permissions && permissions.length > 0) {
      // Convert existing permissions to string array
      const existingIds = existingGroupPermission?.permissions.map(
        (p) => p.permissionId.toString()
      ) || [];

      const incomingIds = permissions.map((p) => p.toString());

      // Check if permissions are actually different
      const isSamePermissions =
        existingIds.length === incomingIds.length &&
        existingIds.every((id) => incomingIds.includes(id));

      // Also check if any permission is missing permissionCode
      const isMissingPermissionCode = (existingGroupPermission?.permissions || []).some(
        (p) => !p.permissionCode
      );

      if (!isSamePermissions || isMissingPermissionCode) {
        const fetchedPermissions = await Permission.find({
          _id: { $in: incomingIds },
        });

        // Always store both permissionId and permissionCode
        const finalPermissions = fetchedPermissions.map((p) => ({
          permissionId: p._id,
          permissionCode: p.code,
          isActive: true,
        }));

        await GroupPermission.findOneAndUpdate(
          { groupId: id },
          {
            groupName: group.groupName,
            permissions: finalPermissions,
          },
          { new: true, upsert: true  }
        );

        isPermissionsUpdated = true;
      }
    }

    // ===============================
    // RESPONSE
    // ===============================
    res.status(200).json({
      message: "Group update completed",
      groupUpdated: isGroupUpdated,
      permissionsUpdated: isPermissionsUpdated,
      group,
    });

  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
};


// ================================
// DELETE GROUP + DELETE PERMISSIONS
// ================================

const deleteGroup = async (req, res) => {
  try {
    const { id } = req.params;

    const group = await Group.findById(id);
    if (!group) return res.status(404).json({ message: "Group not found" });

    // Delete group
    await Group.findByIdAndDelete(id);

    // Delete group permissions also
    await GroupPermission.findOneAndDelete({ groupId: id });

    res.status(200).json({ message: "Group deleted successfully" });

  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

// ================================
// EXPORT ALL FUNCTIONS
// ================================

module.exports = {
  createGroup,
  getAllGroups,
  updateGroup,
  deleteGroup
};
