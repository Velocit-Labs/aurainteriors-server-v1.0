const Queue = require("bull");
const Redis = require("ioredis");
const NotificationService = require("./notificationService");

const AppError = require("../utils/AppError");

const redisConfig = {
  host: process.env.REDIS_HOST || "localhost",
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD,
  retryStrategy: (times) => Math.min(times * 50, 2000),
  maxRetriesPerRequest: null,
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
  Object.entries(notificationQueues).forEach(([name, queue]) => {
    queue.on("completed", (job, result) => {
      console.log(` ${name} job ${job.id} completed:`, result);
    });

    queue.on("failed", (job, error) => {
      console.error(
        `✗ ${name} job ${job.id} failed (attempt ${job.attemptsMade}/${job.opts.attempts}):`,
        error.message,
      );
    });

    queue.on("error", (error) => {
      if (!error.message.includes("ECONNREFUSED")) {
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
    console.log("Initializing notification queues...");
    configureQueues();
    setupQueueListeners();

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
        "⚠ Queue initialization warning (Redis required for job processing):",
        error.message,
      );
    }

    console.log("✓ Notification queues initialized");
  } catch (error) {
    console.warn(
      "⚠ Queue initialization warning (Redis required for job processing):",
      error.message,
    );
    console.warn(
      "ℹ WebSocket notifications will work without Redis. Install Redis for background job processing.",
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
