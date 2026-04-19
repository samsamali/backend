const express = require('express');
const router = express.Router();
const { uploadFile } = require('../controllers/uploadController'); // Adjust path if needed

router.post('/upload', uploadFile); // Single endpoint at `/api/upload/upload`

module.exports = router;