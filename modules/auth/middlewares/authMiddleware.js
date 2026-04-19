
const jwt = require("jsonwebtoken");
const UserGroup = require("../../../modules/admin/models/user-groups");
const GroupPermission = require("../../../modules/admin/models/group-permissions");
const {
  checkUserSubscription,
} = require("../../subscription/services/subscriptionService");


// Token verify middleware
const verifyToken = async (req, res, next) => {
  const authHeader = req.headers["authorization"];

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res
      .status(401)
      .json({ message: "Token missing. Please log in again." });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!decoded || !decoded.userId) {
      return res
        .status(401)
        .json({ message: "Invalid token. Please log in again." });
    }

    // Fetch user's group and group permissions
    let groupPermissions = [];
    const userGroup = await UserGroup.findOne({ userId: decoded.userId });
    if (userGroup) {
      const groupPermDoc = await GroupPermission.findOne({ groupId: userGroup.groupId });
      if (groupPermDoc && Array.isArray(groupPermDoc.permissions)) {
        groupPermissions = groupPermDoc.permissions.filter(p => p.isActive !== false).map(p => p.permissionCode);
      }
    }

    req.user = {
      id: decoded.userId,
      role: decoded.role,
      groupPermissions,
    };
    next();
  } catch (err) {
    console.error("Token error:", err);
    return res
      .status(401)
      .json({ message: "Your token has expired. Please log in again." });
  }
};


// Middleware to check if the user has an active subscription
const ensureActiveSubscription = async (req, res, next) => {
  try {
    // Check if the user has a valid subscription using the user ID from the decoded token
    const userSubscription = await checkUserSubscription(req.user.id);

    // If the user does not have a subscription or it's inactive, block access
    if (!userSubscription || !userSubscription.isActive) {
      return res
        .status(403)
        .json({
          message:
            "You must have an active subscription to access this resource.",
        });
    }

    // Proceed to the next middleware or controller
    next();
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error checking subscription status." });
  }
};

module.exports = { verifyToken, ensureActiveSubscription };
