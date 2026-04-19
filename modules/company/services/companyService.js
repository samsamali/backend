// ✅ CONVERTED: Changed from ES6 import/export to CommonJS require/module.exports
const Company = require('../models/Company');

// ✅ Fetch all companies for a user
const fetchCompanies = async (userId) => {
  try {
    const companies = await Company.find({ userId });
    return companies;
  } catch (error) {
    throw new Error(`Error fetching companies: ${error.message}`);
  }
};

// ✅ Create a new company
const createCompany = async (data) => {
  try {
    const company = new Company(data);
    await company.save();
    return company;
  } catch (error) {
    throw new Error(`Error creating company: ${error.message}`);
  }
};

// ✅ Delete a company
const deleteCompany = async (id) => {
  try {
    const company = await Company.findByIdAndDelete(id);
    return company;
  } catch (error) {
    throw new Error(`Error deleting company: ${error.message}`);
  }
};

module.exports = {
  fetchCompanies,
  createCompany,
  deleteCompany
};
