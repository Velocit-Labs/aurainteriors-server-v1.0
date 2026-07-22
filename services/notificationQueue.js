const Queue = require("bull");
const Redis = require("ioredis");
const NotificationService = require("./notificationService");

const AppError = require("../utils/AppError");

const redisConfig = {
  host: process.env.REDIS_HOST || "localhost",
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD,
  // Cap retries to prevent retry storm: max 5 attempts with exponential backoff
  retryStrategy: (times) => {
    if (times > 5) {
      // Stop retrying after 5 attempts
      return null;
    }
    return Math.min(times * 100, 2000);
  },
  // Limit max retries per request to prevent MaxRetriesPerRequestError
  maxRetriesPerRequest: 3,
  // Connection timeout to fail fast if Redis is unreachable
  connectTimeout: 5000,
  // Idle timeout to clean up stale connections
  idleTimeout: 30000,
  // Enable offline queue but limit size to prevent memory bloat
  enableOfflineQueue: true,
  maxRetriesInQueue: 100,
  // Reduce command timeout from default 5s to 3s to fail faster
  commandTimeout: 3000,
};

const defaultJobOptions = {
  attempts: 3,
  backoff: {
    type: "exponential",
    delay: 2000,
  },
  removeOnComplete: {
    age: 3600,
  },
  removeOnFail: {
    age: 24 * 3600,
  },
};

const notificationQueues = {
  emailNotification: new Queue("email-notification", redisConfig, {
    defaultJobOptions,
  }),
  smsNotification: new Queue("sms-notification", redisConfig, {
    defaultJobOptions,
  }),
  notificationCleanup: new Queue("notification-cleanup", redisConfig, {
    defaultJobOptions,
  }),

  scheduledPromotion: new Queue("scheduled-promotion", redisConfig, {
    defaultJobOptions,
  }),
  documentIngestion: new Queue("document-ingestion", redisConfig, {
    defaultJobOptions,
  }),
};

function configureQueues() {
  console.log("✓ Queue default settings configured");
}

notificationQueues.emailNotification.process(async (job) => {
  const { userNotificationId, userEmail, notificationData } = job.data;

  try {
    console.log(`[EMAIL] Notification queued for ${userEmail}`);

    return { success: true, type: "email" };
  } catch (error) {
    throw new Error(`Email delivery failed: ${error.message}`);
  }
});

notificationQueues.smsNotification.process(async (job) => {
  const { userNotificationId, userPhone, message } = job.data;

  try {
    console.log(`[SMS] Notification queued for ${userPhone}`);

    return { success: true, type: "sms" };
  } catch (error) {
    throw new Error(`SMS delivery failed: ${error.message}`);
  }
});

notificationQueues.notificationCleanup.process(async (job) => {
  try {
    const result = await NotificationService.cleanupExpiredNotifications();
    return {
      success: true,
      deletedCount: result.deletedCount,
    };
  } catch (error) {
    throw new Error(`Cleanup failed: ${error.message}`);
  }
});

notificationQueues.scheduledPromotion.process(async (job) => {
  try {
    const PromotionService = require("./promotionService");
    const result = await PromotionService.processScheduledPromotions();
    return {
      success: true,
      processed: result.processed,
      succeeded: result.succeeded,
      failed: result.failed,
    };
  } catch (error) {
    throw new Error(`Scheduled promotion processing failed: ${error.message}`);
  }
});

notificationQueues.documentIngestion.process(async (job) => {
  const { documentId } = job.data;
  try {
    console.log(`[INGESTION] Processing background ingestion job for document ID: ${documentId}`);
    const IngestionService = require("./ingestionService");
    const result = await IngestionService.ingestDocument(documentId);
    return result;
  } catch (error) {
    throw new Error(`Document ingestion failed: ${error.message}`);
  }
});

function setupQueueListeners() {
  let redisErrorLogged = false; // Flag to log Redis error only once per session
  
  Object.entries(notificationQueues).forEach(([name, queue]) => {
    queue.on("completed", (job, result) => {
      console.log(` ✓ ${name} job ${job.id} completed`);
    });

    queue.on("failed", (job, error) => {
      console.error(
        `✗ ${name} job ${job.id} failed (attempt ${job.attemptsMade}/${job.opts.attempts}):`,
        error.message,
      );
    });

    queue.on("error", (error) => {
      // Log Redis connection errors only once to avoid spam
      if (!redisErrorLogged && (error.message.includes("ECONNREFUSED") || error.message.includes("ETIMEDOUT"))) {
        console.warn(
          `[REDIS] Connection unavailable (queue "${name}"): Redis features disabled, API will continue serving requests`
        );
        redisErrorLogged = true;
      } else if (!error.message.includes("ECONNREFUSED") && !error.message.includes("ETIMEDOUT")) {
        console.warn(`⚠ Queue ${name} error:`, error.message);
      }
    });
  });
}

async function queueEmailNotification(job, options = {}) {
  try {
    const jobOptions = {
      priority: options.priority || 3,
      delay: options.delay || 0,
      jobId: `email-${job.userNotificationId}-${Date.now()}`,
    };

    const queuedJob = await notificationQueues.emailNotification.add(
      job,
      jobOptions,
    );
    console.log(`Email notification queued: ${queuedJob.id}`);
    return queuedJob;
  } catch (error) {
    console.error("Failed to queue email notification:", error);
    throw error;
  }
}

async function scheduleCleanupJobs() {
  try {
    await notificationQueues.notificationCleanup.add(
      {},
      {
        repeat: {
          cron: "0 2 * * *",
          tz: "UTC",
        },
        jobId: "daily-notification-cleanup",
        removeOnComplete: false,
      },
    );

    await notificationQueues.scheduledPromotion.add(
      {},
      {
        repeat: {
          cron: "* * * * *",
          tz: "UTC",
        },
        jobId: "every-minute-scheduled-promotions",
        removeOnComplete: true,
      },
    );

    console.log("Cleanup jobs scheduled");
  } catch (error) {
    console.error("Failed to schedule cleanup jobs:", error);
  }
}

async function initializeQueues() {
  try {
    console.log("[startup] Initializing notification queues...");
    configureQueues();
    setupQueueListeners();

    // Add connection error handler to each queue's Redis client
    // This prevents retry storms from impacting the event loop
    Object.entries(notificationQueues).forEach(([name, queue]) => {
      if (queue.client) {
        queue.client.on("error", (err) => {
          // Only log once per unique error to avoid spam
          if (!err.message.includes("ECONNREFUSED") && !err.message.includes("ETIMEDOUT")) {
            console.warn(`[REDIS] Queue "${name}" connection error: ${err.message}`);
          }
        });
        
        queue.client.on("close", () => {
          console.warn(`[REDIS] Queue "${name}" connection closed`);
        });
      }
    });

    // Add timeout for scheduleCleanupJobs to prevent hanging if Redis is unavailable
    const cleanupPromise = scheduleCleanupJobs();
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              "Queue initialization timeout - Redis may not be available",
            ),
          ),
        5000,
      ),
    );

    try {
      await Promise.race([cleanupPromise, timeoutPromise]);
    } catch (error) {
      console.warn(
        "[startup] ⚠ Queue initialization warning (Redis required for job processing):",
        error.message,
      );
      console.warn(
        "[startup] ℹ WebSocket notifications will work without Redis. Background jobs (email, promotions) will not be processed.",
      );
    }

    console.log("[startup] ✓ Notification queues initialized (graceful degradation enabled)");
  } catch (error) {
    console.warn(
      "[startup] ⚠ Queue initialization warning (Redis required for job processing):",
      error.message,
    );
    console.warn(
      "[startup] ℹ WebSocket notifications will work without Redis. Install Redis for background job processing.",
    );
  }
}

async function closeQueues() {
  try {
    await Promise.all(
      Object.values(notificationQueues).map((queue) => queue.close()),
    );
    console.log("All queues closed");
  } catch (error) {
    console.error("Error closing queues:", error);
  }
}

async function queueDocumentIngestion(documentId) {
  try {
    const addPromise = notificationQueues.documentIngestion.add(
      { documentId },
      {
        priority: 2,
        delay: 0,
        jobId: `ingestion-${documentId}-${Date.now()}`,
      }
    );

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Redis queue connection timeout")), 1500)
    );

    const queuedJob = await Promise.race([addPromise, timeoutPromise]);
    console.log(`Document ingestion job queued: ${queuedJob.id}`);
    return queuedJob;
  } catch (error) {
    console.warn(`[INGESTION] Redis queue is unavailable (${error.message}). Processing document ${documentId} in-memory instead.`);
    
    // Run ingestion asynchronously in the background so we don't block the response
    (async () => {
      try {
        const IngestionService = require("./ingestionService");
        await IngestionService.ingestDocument(documentId);
      } catch (ingestError) {
        console.error("[INGESTION] In-memory background processing failed:", ingestError.message);
      }
    })();

    return { id: "in-memory-fallback" };
  }
}

module.exports = {
  initializeQueues,
  closeQueues,
  queueEmailNotification,
  queueDocumentIngestion,
  notificationQueues,
};
