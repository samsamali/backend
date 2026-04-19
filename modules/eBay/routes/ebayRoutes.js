const express = require("express");
const router = express.Router();
const { ebayController } = require("../controller/ebayController");

// Route to fetch eBay OAuth token
// router.get("/token", fetchToken);

// Initiate Auth'n'Auth flow - redirect to eBay login
router.get('/auth', ebayController.initiateAuth);

// Handle Auth'n'Auth callback from eBay
router.get('/auth/callback', ebayController.handleAuthCallback);

// Get connection status
// router.get('/status', ebayController.getConnectionStatus);

// Disconnect eBay account
router.delete('/disconnect', ebayController.disconnect);

module.exports = router;