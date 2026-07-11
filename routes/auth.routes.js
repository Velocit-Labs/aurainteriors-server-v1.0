const express = require("express");
const router = express.Router();
const passport = require("passport");
const authController = require("../controllers/auth.controller");
const { protect } = require("../middleware/auth.middleware");

// Magic Link Authentication
router.post("/send-magic-link", authController.sendMagicLink);
router.post("/verify-magic-link", authController.verifyMagicLink);

// Admin Email + Password + OTP Authentication
router.post("/admin/login", authController.adminLogin);
router.post("/admin/verify-otp", authController.adminVerifyOtp);

router.get("/me", protect, authController.getMe);
router.post("/logout", authController.logout);

router.get(
  "/google",
  passport.authenticate("google", { scope: ["profile", "email"] }),
);

router.get(
  "/google/callback",
  passport.authenticate("google", {
    session: false,
    failureRedirect: "/login",
  }),
  authController.googleCallback,
);

module.exports = router;
