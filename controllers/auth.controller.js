const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const User = require("../models/user.model");
const {
  sendMagicLinkEmail,
} = require("../services/email.service");

const signToken = (user) =>
  jwt.sign(
    { id: user._id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "7d" },
  );

const attachTokenCookie = (res, token) => {
  res.cookie("jwt", token, {
    expires: new Date(
      Date.now() +
        (Number(process.env.JWT_COOKIE_EXPIRES_IN) || 7) * 24 * 60 * 60 * 1000,
    ),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
  });
};

const sendAuthResponse = (user, statusCode, res) => {
  const token = signToken(user);
  attachTokenCookie(res, token);
  res.status(statusCode).json({ status: "success", token, data: { user } });
};

exports.sendMagicLink = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res
        .status(400)
        .json({ status: "fail", message: "Email is required" });
    }

    let user = await User.findOne({ email, deletedAt: null });

    if (user && user.role === "admin") {
      return res.status(403).json({
        status: "fail",
        message: "Admins must log in through the Admin Portal.",
      });
    }

    if (user && !user.isActive) {
      return res.status(403).json({
        status: "fail",
        message: "This account has been deactivated. Please contact support.",
      });
    }

    if (!user) {
      user = new User({ email });
    }

    const rawToken = user.createMagicLinkToken();
    await user.save({ validateBeforeSave: false });

    res.status(200).json({
      status: "success",
      message: "Sign-in link sent to your email. It expires in 15 minutes.",
    });

    const magicLink = `${process.env.FRONTEND_URL}/auth/verify?token=${rawToken}`;
    console.log(magicLink);
    sendMagicLinkEmail(email, magicLink).catch((err) =>
      console.error(`[email] Magic link failed for ${email}: ${err.message}`),
    );
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
};

exports.verifyMagicLink = async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res
        .status(400)
        .json({ status: "fail", message: "Token is required" });
    }

    const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

    const user = await User.findOne({
      magicLinkToken: hashedToken,
      magicLinkExpires: { $gt: Date.now() },
      deletedAt: null,
    }).select("+magicLinkToken +magicLinkExpires");

    if (!user) {
      return res.status(400).json({
        status: "fail",
        message:
          "This link is invalid or has expired. Please request a new one.",
      });
    }

    if (user.role === "admin") {
      return res.status(403).json({
        status: "fail",
        message: "Admins must log in through the Admin Portal.",
      });
    }

    user.isEmailVerified = true;
    user.magicLinkToken = undefined;
    user.magicLinkExpires = undefined;
    user.updateLoginActivity();
    await user.save({ validateBeforeSave: false });

    sendAuthResponse(user, 200, res);
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
};

exports.googleCallback = (req, res) => {
  if (req.user && req.user.role === "admin") {
    return res.redirect(`${process.env.FRONTEND_URL}/?error=unauthorized_admin`);
  }
  const token = signToken(req.user);
  attachTokenCookie(res, token);
  res.redirect(`${process.env.FRONTEND_URL}/auth/success?token=${token}`);
};

exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    res.status(200).json({ status: "success", data: { user } });
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
};

exports.logout = (_req, res) => {
  res.cookie("jwt", "loggedout", {
    expires: new Date(Date.now() + 10 * 1000),
    httpOnly: true,
  });
  res
    .status(200)
    .json({ status: "success", message: "Logged out successfully" });
};

exports.adminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res
        .status(400)
        .json({ status: "fail", message: "Email and password are required" });
    }

    const user = await User.findOne({ email, deletedAt: null }).select("+password +role +isActive");

    if (!user || user.role !== "admin") {
      return res
        .status(401)
        .json({ status: "fail", message: "Invalid email or password" });
    }

    if (!user.isActive) {
      return res.status(403).json({
        status: "fail",
        message: "This account has been deactivated. Please contact support.",
      });
    }

    const isCorrect = await user.comparePassword(password, user.password);
    if (!isCorrect) {
      return res
        .status(401)
        .json({ status: "fail", message: "Invalid email or password" });
    }

    // Generate OTP
    const rawOtp = user.createOtp();
    await user.save({ validateBeforeSave: false });

    // Send email
    const { sendOtpEmail } = require("../services/email.service");
    res.status(200).json({
      status: "success",
      otpRequired: true,
      message: "A verification code has been sent to your email.",
    });

    sendOtpEmail(email, rawOtp).catch((err) =>
      console.error(`[email] Admin OTP failed for ${email}: ${err.message}`),
    );
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
};

exports.adminVerifyOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      return res
        .status(400)
        .json({ status: "fail", message: "Email and verification code are required" });
    }

    const hashedOtp = crypto.createHash("sha256").update(otp).digest("hex");

    const user = await User.findOne({
      email,
      loginOtp: hashedOtp,
      loginOtpExpires: { $gt: Date.now() },
      deletedAt: null,
    }).select("+loginOtp +loginOtpExpires");

    if (!user) {
      return res.status(400).json({
        status: "fail",
        message: "The code is invalid or has expired. Please try again.",
      });
    }

    if (user.role !== "admin") {
      return res.status(403).json({
        status: "fail",
        message: "You do not have permission to perform this action.",
      });
    }

    // Clear OTP fields
    user.loginOtp = undefined;
    user.loginOtpExpires = undefined;
    user.isEmailVerified = true;
    user.updateLoginActivity();
    await user.save({ validateBeforeSave: false });

    sendAuthResponse(user, 200, res);
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
};
