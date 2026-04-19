const express = require('express');
const { importTemuProducts } = require('../controllers/productController.js');
const { verifyToken } = require('../../auth/middlewares/authMiddleware');

const router = express.Router();

// Route to import products from Temu (protected)
router.post('/import/temu', verifyToken, importTemuProducts);

module.exports = router;
