const express = require('express');
const { createCompany, getCompanies, deleteCompany } = require('../controllers/companyController');
const { verifyToken, ensureActiveSubscription } = require('../../auth/middlewares/authMiddleware');
const { ensureCompanyExists } = require('../middlewares/companyMiddleware');

const router = express.Router();

router.post('/create', verifyToken, ensureActiveSubscription, ensureCompanyExists, createCompany);
router.get('/', verifyToken, ensureActiveSubscription, ensureCompanyExists, getCompanies);
router.delete('/:id', verifyToken, ensureActiveSubscription, ensureCompanyExists, deleteCompany);

module.exports = router;
