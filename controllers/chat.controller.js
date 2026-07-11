const ChatService = require("../services/chatService");
const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/AppError");

// ==================== CUSTOMER OPERATIONS ====================

/**
 * Start a new chat (Customer)
 */
exports.startChat = catchAsync(async (req, res, next) => {
  const { subject, metadata } = req.body;

  const chat = await ChatService.createChat(req.user._id, {
    subject,
    metadata,
  });

  res.status(201).json({
    status: "success",
    message: "Chat started successfully",
    data: { chat },
  });
});

/**
 * Get customer's chats (Customer)
 */
exports.getMyChats = catchAsync(async (req, res, next) => {
  const { page = 1, limit = 20, status } = req.query;

  const result = await ChatService.getCustomerChats(req.user._id, {
    page: parseInt(page, 10),
    limit: parseInt(limit, 10),
    status,
  });

  res.status(200).json({
    status: "success",
    data: {
      chats: result.chats,
      pagination: result.pagination,
    },
  });
});

/**
 * Get chat details (Customer/Admin)
 */
exports.getChatDetails = catchAsync(async (req, res, next) => {
  const chat = await ChatService.getChatById(
    req.params.id,
    req.user._id,
    req.user.role
  );

  res.status(200).json({
    status: "success",
    data: { chat },
  });
});

/**
 * Get chat messages (Customer/Admin)
 */
exports.getChatMessages = catchAsync(async (req, res, next) => {
  const { page = 1, limit = 50 } = req.query;

  const result = await ChatService.getChatMessages(
    req.params.id,
    req.user._id,
    req.user.role,
    {
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
    }
  );

  res.status(200).json({
    status: "success",
    data: {
      messages: result.messages,
      pagination: result.pagination,
    },
  });
});

/**
 * Send message in chat (Customer/Admin)
 */
exports.sendMessage = catchAsync(async (req, res, next) => {
  const { content } = req.body;
  const attachments = req.processedAttachments || [];

  // Ensure either content or attachments is provided
  if ((!content || !content.trim()) && attachments.length === 0) {
    return next(new AppError("Message content or attachments required", 400));
  }

  const message = await ChatService.sendMessage(
    req.params.id,
    req.user._id,
    req.user.role,
    {
      content,
      attachments,
    }
  );

  res.status(201).json({
    status: "success",
    message: "Message sent successfully",
    data: { message },
  });
});

/**
 * Mark messages as read (Customer/Admin)
 */
exports.markMessagesRead = catchAsync(async (req, res, next) => {
  const result = await ChatService.markMessagesAsRead(
    req.params.id,
    req.user._id,
    req.user.role
  );

  res.status(200).json({
    status: "success",
    message: "Messages marked as read",
    data: { modifiedCount: result.modifiedCount },
  });
});

/**
 * Close chat (Customer/Admin)
 */
exports.closeChat = catchAsync(async (req, res, next) => {
  const chat = await ChatService.closeChat(
    req.params.id,
    req.user._id,
    req.user.role
  );

  res.status(200).json({
    status: "success",
    message: "Chat closed successfully",
    data: { chat },
  });
});

// ==================== ADMIN OPERATIONS ====================

/**
 * Get all chats (Admin)
 */
exports.getAllChats = catchAsync(async (req, res, next) => {
  const { page = 1, limit = 20, status, priority, sortBy } = req.query;

  const result = await ChatService.getAllChats({
    page: parseInt(page, 10),
    limit: parseInt(limit, 10),
    status,
    priority,
    sortBy,
  });

  res.status(200).json({
    status: "success",
    data: {
      chats: result.chats,
      pagination: result.pagination,
    },
  });
});

/**
 * Get waiting queue (Admin)
 */
exports.getWaitingQueue = catchAsync(async (req, res, next) => {
  const chats = await ChatService.getWaitingQueue();

  res.status(200).json({
    status: "success",
    data: { chats },
  });
});

/**
 * Resolve chat (Admin)
 */
exports.resolveChat = catchAsync(async (req, res, next) => {
  const chat = await ChatService.resolveChat(req.params.id, req.user._id);

  res.status(200).json({
    status: "success",
    message: "Chat resolved successfully",
    data: { chat },
  });
});

/**
 * Get chat statistics (Admin)
 */
exports.getChatStats = catchAsync(async (req, res, next) => {
  const stats = await ChatService.getChatStats();

  res.status(200).json({
    status: "success",
    data: { stats },
  });
});

/**
 * Toggle AI Bot active state (Customer/Admin)
 */
exports.toggleBot = catchAsync(async (req, res, next) => {
  const { botActive } = req.body;

  const chat = await ChatService.toggleBot(
    req.params.id,
    req.user._id,
    req.user.role,
    botActive
  );

  res.status(200).json({
    status: "success",
    message: `AI Bot ${botActive ? "enabled" : "disabled"} successfully`,
    data: { chat },
  });
});

module.exports = exports;
