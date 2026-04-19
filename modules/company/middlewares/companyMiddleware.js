const Company = require('../models/Company');

exports.ensureCompanyExists = async (req, res, next) => {
  try {
    const userCompanies = await Company.find({ userId: req.user.id });
    if (userCompanies.length === 0) {
      return res.status(400).json({ message: 'You must create a company before proceeding.' });
    }
    next();
  } catch (error) {
    return res.status(500).json({ message: 'Error verifying companies', error: error.message });
  }
};
