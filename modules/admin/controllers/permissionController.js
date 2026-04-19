const Permission = require("../models/Permission");

// Create new Permission
const createPermission = async (req, res) => {
  try {
    const { code, name, description } = req.body;

    if (!code || !name) {
      return res.status(400).json({ message: "Permission name is required" });
    }

    const newPermission = new Permission({ code, name, description });
    await newPermission.save();

    res.status(201).json({
      message: "Permission created successfully",
      permission: newPermission,
    });
  } catch (error) {
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

// Get all permissions
const getAllPermissions = async (req, res) => {
  try {
    const permissions = await Permission.find();
    res.status(200).json(permissions);
  } catch (error) {
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

// DELETE: Delete a permission by ID
const deletePermission = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if permission exists
    const permission = await Permission.findById(id);
    if (!permission) {
      return res.status(404).json({ message: "Permission not found" });
    }

    // Delete the permission
    await Permission.findByIdAndDelete(id);

    res.status(200).json({ message: "Permission deleted successfully" });
  } catch (error) {
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

// PUT: Update a permission by ID
const updatePermission = async (req, res) => {  
  try {
    const { id } = req.params;
    const { code, name, description } = req.body;
    const permission = await Permission.findById(id);
    if (!permission) {
      return res.status(404).json({ message: "Permission not found" });
    }
    // Update the permission
    permission.code = code;
    permission.name = name;
    permission.description = description;
    await permission.save();
    res.status(200).json({ message: "Permission updated successfully" });
    } catch (error) {
      res.status(500).json({
        message: "Server error",
        error: error.message,
        });
        }
};
        

module.exports = {
  createPermission,
  getAllPermissions,
  deletePermission,
  updatePermission,
};
