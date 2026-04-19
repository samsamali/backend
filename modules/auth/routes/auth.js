const express = require("express");
const { signup, userlogin, login, getAllUsers, updateUser, deleteUser } = require("../controllers/authController");
const { verifyToken } = require("../middlewares/authMiddleware");

const router = express.Router();

// User auth
router.post("/signup", signup);
router.post("/login", login);
router.post("/userlogin", userlogin);

router.get("/users", verifyToken, getAllUsers);
router.put('/users/:id', verifyToken, updateUser);
router.delete('/users/:id', verifyToken, deleteUser);

module.exports = router;
