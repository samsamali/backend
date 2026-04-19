// Example: Check if user is Super Admin (if needed)
exports.isSuperAdmin = (req, res, next) => {
  if (req.user && req.user.role === 'superadmin') {
    next();
  } else {
    return res.status(403).json({ message: 'Access Denied: SuperAdmin only.' });
  }
};
