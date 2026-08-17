const express = require("express");
const router = express.Router();

// System health and monitoring endpoints
router.get("/keep-alive-status", (req, res) => {
  try {
    if (!global.keepAliveService) {
      return res.status(503).json({
        success: false,
        error: "Keep-Alive service not initialized",
      });
    }

    const status = global.keepAliveService.getStatus();
    res.status(200).json({
      success: true,
      data: status,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

module.exports = router;
