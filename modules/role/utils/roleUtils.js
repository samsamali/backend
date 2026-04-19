exports.validateRoleName = (name) => {
  return typeof name === 'string' && name.trim().length > 0;
};
