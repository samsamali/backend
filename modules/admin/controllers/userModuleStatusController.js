const UserModuleStatus = require("../models/UserModuleStatus");

// Create or Update UserModule Status
const updateUserModuleStatus = async (req, res) => {
  try {
    const { userId, moduleId, status } = req.body;
    if (!userId || !moduleId || !status) {
      return res.status(400).json({
        message: "Missing required parameters",
      });
    }

    let userModuleStatus = await UserModuleStatus.findOne({ userId, moduleId });

    if (userModuleStatus) {
      // Update existing
      userModuleStatus.status = status;
      userModuleStatus.updatedAt = new Date();
    } else {
      // Create new
      userModuleStatus = new UserModuleStatus({
        userId,
        moduleId,
        status,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    await userModuleStatus.save();

    res.status(200).json({
      message: "User module status updated successfully",
      userModuleStatus,
    });
  } catch (error) {
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

// Get All UserModule Statuses
const getAllUserModuleStatus = async (req, res) => {
  try {
    const statuses = await UserModuleStatus.find().lean();
    res.json(statuses);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Delete UserModuleStatus
const deleteUserModuleStatus = async (req, res) => {
  try {
    const { userId, moduleId } = req.body;

    if (!userId || !moduleId) {
      return res.status(400).json({
        message: "userId and moduleId are required.",
      });
    }

    const deleted = await UserModuleStatus.findOneAndDelete({
      userId,
      moduleId,
    });

    if (!deleted) {
      return res.status(404).json({
        message: "UserModuleStatus not found.",
      });
    }

    res.status(200).json({
      message: "UserModuleStatus deleted successfully.",
    });
  } catch (error) {
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

module.exports = {
  updateUserModuleStatus,
  getAllUserModuleStatus,
  deleteUserModuleStatus,
};
