// backend/modules/user/user.routes.js
const express = require("express");
const router = express.Router();
const { getTrialInfo, getUserProfile, UpdateUserProfile, updateProfilePicture } = require("./userController");
const { verifyToken } = require("../../modules/auth/middlewares/authMiddleware"); // Make sure verifyToken is imported properly
//  User Profile API
router.get("/profile/:id", verifyToken, getUserProfile);

// Upload profile picture API
router.put("/update/profile-picture/:id", verifyToken, updateProfilePicture);

// put update user profile API
router.put("/update/profile/:id", verifyToken, UpdateUserProfile);

// Protect the trial-info route with verifyToken middleware
router.get("/trial-info", verifyToken, getTrialInfo);

module.exports = router;
