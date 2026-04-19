const express = require('express');
const router = express.Router();
const { updatePassword } = require('../controllers/updatePasswordController');
const { verifyToken } = require('../middlewares/authMiddleware'); // JWT verify

router.post('/update-password', verifyToken, updatePassword);

module.exports = router;
