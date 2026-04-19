const UserRole = require("../models/UserRole");

exports.checkAccess = (module, accessType) => async (req, res, next) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    if (!companyId) {
      return res.status(400).json({ message: "Company ID is required" });
    }

    // Fetch user's role for the specific company
    const userRole = await UserRole.findOne({ userId, companyId }).populate(
      "roleId"
    );
    if (!userRole) {
      return res
        .status(403)
        .json({ message: "Access Denied: No role assigned for this company." });
    }

    // Check if the role has required permissions
    const hasPermission = userRole.roleId.permissions.some(
      (perm) => perm.module === module && perm.access === accessType
    );

    if (!hasPermission) {
      return res
        .status(403)
        .json({
          message: `Access Denied: ${accessType} permission required for ${module}.`,
        });
    }

    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Internal Server Error" });
  }
};
