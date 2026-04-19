// Middleware to check if user has required permission

module.exports = function(requiredPermission) {
  return (req, res, next) => {
    // Check group permissions attached to req.user by verifyToken
    const groupPermissions = req.user && req.user.groupPermissions;
    if (!groupPermissions || !groupPermissions.includes(requiredPermission)) {
      return res.status(403).json({ message: 'Access denied: insufficient permissions.' });
    }
    next();
  };
};
