require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const morgan = require("morgan");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const passport = require("./config/passport");
const http = require("http");

const { connectDatabase } = require("./config/database");
const globalErrorHandler = require("./middleware/error.middleware");
const AppError = require("./utils/AppError");
const NotificationGateway = require("./services/notificationGateway");
const {
  initializeQueues,
  closeQueues,
} = require("./services/notificationQueue");

const notificationEventEmitter = require("./services/notificationEventEmitter");
const {
  fetchAllFeeds,
  updateFeaturedArticles,
} = require("./services/rssFeedService");

const PORT = process.env.PORT || 3001;

connectDatabase();

const app = express();

const allowedOrigins = [
  "http://localhost:5173",  // customer dev
  "http://localhost:5174",  // admin dev
  process.env.FRONTEND_URL,
  process.env.ADMIN_URL,
].filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);
      if (allowedOrigins.indexOf(origin) === -1) {
        const msg =
          "The CORS policy for this site does not allow access from the specified Origin.";
        return callback(new Error(msg), false);
      }
      return callback(null, true);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);

app.use(cookieParser());
app.use(express.json());
app.use(morgan("dev"));
app.use(passport.initialize());

app.use("/api/v1/users", require("./routes/user.routes"));
app.use("/api/v1/auth", require("./routes/auth.routes"));
app.use("/api/v1/addresses", require("./routes/address.routes"));
app.use("/api/v1/profile", require("./routes/profile.routes"));
app.use("/api/v1/categories", require("./routes/category.routes"));
app.use("/api/v1/products", require("./routes/product.routes"));
app.use("/api/v1/wishlist", require("./routes/wishlist.routes"));
app.use("/api/v1/cart", require("./routes/cart.routes"));
app.use("/api/v1/discounts", require("./routes/discount.routes"));
app.use("/api/v1/orders", require("./routes/order.routes"));
app.use("/api/v1/notifications", require("./routes/notification.routes"));
app.use("/api/v1/promotions", require("./routes/promotion.routes"));
app.use("/api/v1/reviews", require("./routes/admin.review.routes"));
app.use("/api/v1/announcements", require("./routes/announcement.routes"));
app.use("/api/v1/chats", require("./routes/chat.routes"));
app.use("/api/v1/documents", require("./routes/document.routes"));
app.use("/api/v1/blogs", require("./routes/blog.routes"));
app.use("/api/v1/contacts", require("./routes/contact.routes"));
app.use("/api/v1/analytics", require("./routes/analytics.routes"));
app.use("/api/v1/newsletter", require("./routes/newsletter.routes"));
app.use("/api/v1/system", require("./routes/system.routes"));

app.use((req, res, next) => {
  next(new AppError(`Cannot find ${req.originalUrl} on this server`, 404));
});

app.use(globalErrorHandler);

const httpServer = http.createServer(app);

let notificationGateway;

const startServer = async () => {
  try {
    console.log("Starting server initialization...");
    await initializeQueues();
    console.log("✓ Queues initialized");

    console.log("Initializing notification gateway...");
    notificationGateway = new NotificationGateway(httpServer);
    console.log("✓ Notification gateway initialized");

    const heartbeatInterval = setInterval(() => {
      notificationGateway.broadcastHeartbeat();
    }, 60000);

    const cleanupInterval = setInterval(
      () => {
        notificationGateway.cleanupStaleConnections();
      },
      5 * 60 * 1000,
    );

    // RSS Feed Scheduler - fetch every 6 hours
    const RSS_FETCH_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours
    const rssFeedInterval = setInterval(async () => {
      console.log("⏰ Running scheduled RSS feed fetch...");
      try {
        await fetchAllFeeds();
        await updateFeaturedArticles(5);
        console.log("✓ Scheduled RSS feed fetch completed");
      } catch (error) {
        console.error("✗ Scheduled RSS feed fetch failed:", error.message);
      }
    }, RSS_FETCH_INTERVAL);

    // Initial RSS feed fetch on startup (after 30 seconds to allow DB connection)
    setTimeout(async () => {
      console.log("📰 Running initial RSS feed fetch...");
      try {
        await fetchAllFeeds();
        await updateFeaturedArticles(5);
        console.log("✓ Initial RSS feed fetch completed");
      } catch (error) {
        console.error("✗ Initial RSS feed fetch failed:", error.message);
      }
    }, 30000);


    global.notificationGateway = notificationGateway;
    global.notificationEventEmitter = notificationEventEmitter;

    httpServer.listen(PORT, "0.0.0.0", () => {
      console.log(`✓ Server running on PORT ${PORT}`);
      console.log(
        `✓ Active users: ${notificationGateway.getActiveUserCount()}`,
      );
    });

    const shutdown = async () => {
      console.log("\nShutting down gracefully...");
      clearInterval(heartbeatInterval);
      clearInterval(cleanupInterval);
      clearInterval(rssFeedInterval);
      await notificationGateway.close();
      await closeQueues();
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
};

startServer();
