const Company = require('../models/Company');

exports.createCompany = async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ message: 'Company name is required' });
    }
    const company = new Company({
      name,
      userId: req.user.id,
    });
    await company.save();
    res.status(201).json({ message: 'Company created successfully', company });
  } catch (error) {
    res.status(500).json({ message: 'Error creating company', error: error.message });
  }
};

exports.getCompanies = async (req, res) => {
  try {
    const companies = await Company.find({ userId: req.user.id });
    res.status(200).json(companies);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching companies', error: error.message });
  }
};

exports.deleteCompany = async (req, res) => {
  try {
    const { id } = req.params;
    const company = await Company.findById(id);

    if (!company || company.userId.toString() !== req.user.id) {
      return res.status(404).json({ message: 'Company not found or not authorized' });
    }

    await company.deleteOne();
    res.status(200).json({ message: 'Company deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting company', error: error.message });
  }
};
