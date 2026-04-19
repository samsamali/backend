const Role = require('../models/Role');

// Create Role Service
exports.createRole = async ({ name, description, is_default }) => {
  const newRole = new Role({ name, description, is_default });
  return await newRole.save();
};

// List All Roles Service
exports.listRoles = async () => {
  return await Role.find({});
};
