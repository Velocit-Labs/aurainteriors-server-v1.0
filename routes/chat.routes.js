const express = require("express");
const router = express.Router();
const chatController = require("../controllers/chat.controller");
const { protect, restrictTo } = require("../middleware/auth.middleware");
const validate = require("../middleware/validate.middleware");
const {
  uploadChatAttachment,
  processChatAttachment,
} = require("../middleware/upload.middleware");
const {
  startChatSchema,
  sendMessageSchema,
  getChatsQuerySchema,
  getMessagesQuerySchema,
} = require("../validators/chat.validator");

router.use(protect);

router.post(
  "/",
  validate(startChatSchema),
  chatController.startChat
);

router.get(
  "/my",
  restrictTo("customer"),
  validate(getChatsQuerySchema, "query"),
  chatController.getMyChats
);

router.get("/:id", chatController.getChatDetails);

router.get(
  "/:id/messages",
  validate(getMessagesQuerySchema, "query"),
  chatController.getChatMessages
);

router.post(
  "/:id/messages",
  uploadChatAttachment,
  processChatAttachment,
  validate(sendMessageSchema),
  chatController.sendMessage
);

router.patch("/:id/read", chatController.markMessagesRead);

router.patch("/:id/close", chatController.closeChat);
router.patch("/:id/toggle-bot", chatController.toggleBot);

router.get(
  "/admin/stats",
  restrictTo("admin"),
  chatController.getChatStats
);

router.get(
  "/admin/all",
  restrictTo("admin"),
  validate(getChatsQuerySchema, "query"),
  chatController.getAllChats
);

router.get(
  "/admin/queue",
  restrictTo("admin"),
  chatController.getWaitingQueue
);

router.patch(
  "/:id/resolve",
  restrictTo("admin"),
  chatController.resolveChat
);

module.exports = router;
