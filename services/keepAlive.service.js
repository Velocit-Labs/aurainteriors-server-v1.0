/**
 * Keep-Alive Service
 * 
 * Prevents Render (or other hosting platforms) from spinning down the server
 * during periods of inactivity. Pings the health endpoint periodically.
 * 
 * Usage:
 *   - Development: Disabled by default
 *   - Production: Enabled automatically when NODE_ENV=production
 * 
 * Configuration:
 *   - KEEP_ALIVE_ENABLED: Set to 'true' to enable (auto-enabled in production)
 *   - KEEP_ALIVE_INTERVAL: Interval in minutes between pings (default: 14 minutes)
 *   - BACKEND_URL: Base URL to ping (required for external pinging)
 */

const axios = require("axios");

class KeepAliveService {
  constructor(options = {}) {
    // Auto-enable in production, unless explicitly disabled
    const isProduction = process.env.NODE_ENV === "production";
    this.enabled =
      (process.env.KEEP_ALIVE_ENABLED === "true") || isProduction;

    // Default: ping every 14 minutes (Render has a 15-minute idle timeout on free tier)
    this.intervalMinutes =
      parseInt(process.env.KEEP_ALIVE_INTERVAL) || 14;

    // Use custom backend URL or infer from environment
    this.backendUrl =
      process.env.BACKEND_URL ||
      process.env.RENDER_EXTERNAL_URL ||
      `http://localhost:${process.env.PORT || 3001}`;

    this.intervalId = null;
    this.requestCount = 0;
    this.lastPingTime = null;
    this.failureCount = 0;
    this.maxConsecutiveFailures = 5;

    if (this.enabled) {
      console.log(
        `[KeepAlive] Service initialized (interval: ${this.intervalMinutes}m)`,
      );
    }
  }

  /**
   * Start the keep-alive service
   */
  start() {
    if (!this.enabled) {
      console.log("[KeepAlive] Service is disabled");
      return;
    }

    if (this.intervalId) {
      console.log("[KeepAlive] Service is already running");
      return;
    }

    // Ping immediately on startup (after a short delay)
    setTimeout(() => {
      this.ping();
    }, 5000);

    // Then set up recurring pings
    const intervalMs = this.intervalMinutes * 60 * 1000;
    this.intervalId = setInterval(() => {
      this.ping();
    }, intervalMs);

    console.log(`[KeepAlive] ✓ Service started (pinging every ${this.intervalMinutes}m)`);
  }

  /**
   * Stop the keep-alive service
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log("[KeepAlive] ✓ Service stopped");
    }
  }

  /**
   * Perform a health check ping
   */
  async ping() {
    const startTime = Date.now();

    try {
      const url = `${this.backendUrl}/health`;
      const response = await axios.get(url, {
        timeout: 10000, // 10 second timeout
      });

      const duration = Date.now() - startTime;
      this.requestCount++;
      this.lastPingTime = new Date();
      this.failureCount = 0; // Reset failure counter on success

      console.log(
        `[KeepAlive] ✓ Ping #${this.requestCount} succeeded (${duration}ms)`,
      );

      return {
        success: true,
        duration,
        timestamp: this.lastPingTime,
        status: response.status,
      };
    } catch (error) {
      this.failureCount++;
      const duration = Date.now() - startTime;

      console.error(
        `[KeepAlive] ✗ Ping failed (attempt ${this.failureCount}/${this.maxConsecutiveFailures}): ${error.message}`,
      );

      // If too many consecutive failures, log a warning
      if (this.failureCount >= this.maxConsecutiveFailures) {
        console.error(
          `[KeepAlive] ⚠ ${this.failureCount} consecutive failures - check backend connectivity`,
        );
      }

      return {
        success: false,
        duration,
        error: error.message,
        timestamp: new Date(),
      };
    }
  }

  /**
   * Get service status
   */
  getStatus() {
    return {
      enabled: this.enabled,
      running: this.intervalId !== null,
      backendUrl: this.backendUrl,
      intervalMinutes: this.intervalMinutes,
      requestCount: this.requestCount,
      lastPingTime: this.lastPingTime,
      failureCount: this.failureCount,
      environment: process.env.NODE_ENV,
    };
  }
}

module.exports = KeepAliveService;
