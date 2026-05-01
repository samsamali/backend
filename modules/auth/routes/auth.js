const express = require("express");
const { signup, userlogin, login, getAllUsers, updateUser, deleteUser, forgotPassword, verifyOTP, resetPassword, googleLogin, facebookLogin, facebookCallback, githubLogin, githubCallback } = require("../controllers/authController");
const { verifyToken } = require("../middlewares/authMiddleware");

const router = express.Router();

// User auth
router.post("/signup", signup);
router.post("/login", login);
router.post("/userlogin", userlogin);

// Password reset flow
router.post("/forgot-password", forgotPassword);
router.post("/verify-otp",      verifyOTP);
router.post("/reset-password",  resetPassword);

// Google OAuth
router.post("/google",             googleLogin);

// Facebook OAuth
router.get("/facebook",            facebookLogin);
router.get("/facebook/callback",   facebookCallback);

// GitHub OAuth
router.get("/github",              githubLogin);
router.get("/github/callback",     githubCallback);

router.get("/users", verifyToken, getAllUsers);
router.put('/users/:id', verifyToken, updateUser);
router.delete('/users/:id', verifyToken, deleteUser);

module.exports = router;
