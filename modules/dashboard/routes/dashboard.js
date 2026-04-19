const express = require('express');
const { getDashboardData } = require('../controllers/dashboardController');
const { verifyToken, ensureActiveSubscription } = require('../../auth/middlewares/authMiddleware');
const router = express.Router();

console.log("Dashboard route Access");
// Protected dashboard route
router.get('/', verifyToken, ensureActiveSubscription, getDashboardData);

module.exports = router;
