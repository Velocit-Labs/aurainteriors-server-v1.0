const Chat = require("../models/chat.model");
const ChatMessage = require("../models/chatMessage.model");
const AppError = require("../utils/AppError");
const notificationEventEmitter = require("./notificationEventEmitter");
const User = require("../models/user.model");
const mongoose = require("mongoose");

class ChatService {
  async createChat(customerId, data = {}) {
        const { subject, metadata } = data;

    const chat = await Chat.create({
      customer: customerId,
      subject,
      metadata: {
        ...(metadata || {}),
        botActive: true,
      },
      status: "ai_handling",
    });

    const populatedChat = await chat.populate("customer", "firstName lastName email");

    // Emit admin notification for new chat
    try {
      notificationEventEmitter.emit("admin:chat:started", {
        chatId: chat._id,
        customerName: populatedChat.customer ? `${populatedChat.customer.firstName} ${populatedChat.customer.lastName}` : null,
        customerEmail: populatedChat.customer?.email,
        subject,
      });
    } catch (error) {
      console.error("Failed to emit admin:chat:started event:", error.message);
    }

    // Auto-create Welcome Message from AI bot
    try {
      const admin = await User.findOne({ role: 'admin' }).select('_id');

      if (admin) {
        await ChatMessage.create({
          chat: chat._id,
          sender: admin._id,
          senderRole: 'bot',          // FIX 8: tagged as bot, not human admin
          isAiGenerated: true,
          messageType: 'text',
          content: 'Hello! Welcome to Aura Interiors. How can I help you find the perfect piece for your home?',
          deliveredAt: new Date(),
          isRead: true
        });

        // Update chat unread/lastMessage
        await Chat.findByIdAndUpdate(chat._id, {
          lastMessageAt: new Date(),
          $inc: { unreadCountCustomer: 1 }
        });
      }
    } catch (msgError) {
      console.error("Failed to create automated welcome message:", msgError.message);
    }

    return populatedChat;
  }

  async enrichChatWithUnreadCounts(chatJson) {
    if (!chatJson) return chatJson;

    // PERF-OPT 5: Use aggregation pipeline to compute unread counts efficiently
    // instead of two separate count queries per chat
    const unreadStats = await ChatMessage.aggregate([
      { $match: { chat: mongoose.Types.ObjectId(chatJson._id), deletedAt: null } },
      {
        $group: {
          _id: "$chat",
          customerUnread: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $in: ["$senderRole", ["admin", "bot"]] },
                    { $gt: ["$createdAt", chatJson.lastReadCustomerAt || new Date(0)] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          adminUnread: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$senderRole", "customer"] },
                    { $gt: ["$createdAt", chatJson.lastReadAdminAt || new Date(0)] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ]);

    const stats = unreadStats[0] || { customerUnread: 0, adminUnread: 0 };

    const lastMessage = await ChatMessage.findOne({
      chat: chatJson._id,
      deletedAt: null,
    })
      .sort({ createdAt: -1 })
      .select("content messageType attachments")
      .lean();

    let lastMessageText = "";
    if (lastMessage) {
      if (lastMessage.messageType === "text") {
        lastMessageText = lastMessage.content;
      } else if (lastMessage.messageType === "image") {
        lastMessageText = "📷 Image";
      } else if (lastMessage.messageType === "file") {
        lastMessageText = "📁 File";
      } else if (lastMessage.messageType === "system") {
        lastMessageText = lastMessage.content;
      }
    }

    return {
      ...chatJson,
      unreadCountCustomer: stats.customerUnread,
      unreadCountAdmin: stats.adminUnread,
      lastMessageText: lastMessageText || chatJson.subject || "General Inquiry",
    };
  }

  async getChatById(chatId, userId, userRole) {
    const chat = await Chat.findOne({
      _id: chatId,
      deletedAt: null,
    }).populate("customer", "firstName lastName email avatar");

    if (!chat) {
      throw new AppError("Chat not found", 404);
    }

    if (userRole !== "admin" && chat.customer._id.toString() !== userId.toString()) {
      throw new AppError("You are not authorized to view this chat", 403);
    }

    const chatJson = chat.toJSON();
    return this.enrichChatWithUnreadCounts(chatJson);
  }

  async getCustomerChats(customerId, options = {}) {
    const result = await Chat.getCustomerChats(customerId, options);
    result.chats = await Promise.all(
      result.chats.map((chat) => this.enrichChatWithUnreadCounts(chat))
    );
    return result;
  }

  async getAllChats(options = {}) {
    const result = await Chat.getAllChats(options);
    result.chats = await Promise.all(
      result.chats.map((chat) => this.enrichChatWithUnreadCounts(chat))
    );
    return result;
  }

  async getWaitingQueue() {
    const chats = await Chat.getWaitingQueue();
    return Promise.all(chats.map((chat) => this.enrichChatWithUnreadCounts(chat)));
  }

  async sendMessage(chatId, senderId, senderRole, data = {}) {
    const { content, attachments, isInternalNote } = data;

    const chat = await Chat.findOne({
      _id: chatId,
      deletedAt: null,
    });

    if (!chat) {
      throw new AppError("Chat not found", 404);
    }

    // FIX 8: allow 'bot' senderRole in addition to 'admin'
    if (!['admin', 'bot'].includes(senderRole) && chat.customer.toString() !== senderId.toString()) {
      throw new AppError("You are not authorized to message this chat", 403);
    }

    let messageType = "text";
    if (attachments && attachments.length > 0) {
      const hasImages = attachments.some((att) => att.fileType === "image");
      messageType = hasImages ? "image" : "file";
    }

    const message = await ChatMessage.create({
      chat: chatId,
      sender: senderId,
      senderRole,
      messageType,
      isInternalNote: isInternalNote || false,
      content,
      attachments,
      deliveredAt: new Date(),
    });

    // Update chat based on sender role.
    // CHAT-FIXES-8 Fix 1: Use timestamp-based read tracking instead of static counters.
    // Unread counts are now derived dynamically: count(messages.createdAt > lastReadAt).
    const now = new Date();
    const updateData = {
      lastMessageAt: now,
    };

    let didReopen = false;

    if (senderRole === "customer") {
      // When the customer sends, they've implicitly read up to now
      updateData.lastReadCustomerAt = now;
      updateData.customerTyping = false;

      // CHAT-FIXES-9 Fix 1: Reopen resolved/closed chat to ai_handling, reactivating AI bot
      if (["resolved", "closed"].includes(chat.status)) {
        updateData.status = "ai_handling";
        updateData.metadata = {
          ...(chat.metadata || {}),
          botActive: true,
        };
        didReopen = true;
      }
    } else if (senderRole === "bot") {
      // Bot reply — bot has read the customer's messages!
      updateData.lastReadAdminAt = now;
      
      // Mark all customer messages in this chat as read
      await ChatMessage.markAsRead(chatId, "admin");

      // Broadcast read status via socket so customer's client knows it's read/seen
      if (global.notificationGateway) {
        const roomId = chatId.toString();
        global.notificationGateway.io.to(`chat:${roomId}`).emit("chat:messages:read", {
          chatId: roomId,
          userId: senderId,
          userRole: "admin",
        });
      }
    } else {
      // Human admin reply — admin has seen the conversation up to now
      updateData.lastReadAdminAt = now;
      updateData.adminTyping = false;
      updateData.metadata = {
        ...(chat.metadata || {}),
        botActive: false,
      };
      if (["ai_handling", "escalated", "waiting", "active"].includes(chat.status)) {
        updateData.status = "agent_handling";
      }
    }

    await Chat.findByIdAndUpdate(chatId, updateData);

    // If customer message reopened the chat, post a system message about AI reactivated
    if (didReopen) {
      try {
        const botUser = await User.findOne({ role: "admin" }).select("_id");
        if (botUser) {
          const sysMsg = await ChatMessage.create({
            chat: chatId,
            sender: botUser._id,
            senderRole: "bot",
            isAiGenerated: false,
            messageType: "text",
            content: "Conversation reopened. AI Assistant has been reactivated to assist you.",
            deliveredAt: new Date(),
          });
          if (global.notificationGateway) {
            const populated = await sysMsg.populate("sender", "firstName lastName email role avatar");
            global.notificationGateway.io.to(`chat:${chatId.toString()}`).emit("chat:message:new", {
              chatId: chatId.toString(),
              message: populated.toObject(),
              timestamp: new Date(),
            });
          }
        }
      } catch (err) {
        console.error("[CHAT-FIXES-9] Failed to send reopen system message:", err.message);
      }
    }

    // Broadcast message via socket if gateway is available
    // PERF-OPT 4: Non-blocking async broadcast - don't wait for socket emit to complete
    if (global.notificationGateway) {
      // Fire-and-forget: populate and emit without awaiting
      setImmediate(async () => {
        try {
          const populatedMessage = await message.populate("sender", "firstName lastName email role avatar");
          const messageData = populatedMessage.toObject();
          const roomId = chatId.toString();

          console.log(`Broadcasting message to room chat:${roomId}`);

          global.notificationGateway.io.to(`chat:${roomId}`).emit("chat:message:new", {
            chatId: roomId,
            message: messageData,
            timestamp: new Date(),
          });

          // Broadcast status change socket events
          if (didReopen) {
            global.notificationGateway.io.to(`chat:${roomId}`).emit("chat:status:changed", {
              chatId: roomId,
              status: "ai_handling",
              botActive: true,
            });
          } else if (senderRole === "admin" && ["ai_handling", "escalated", "waiting", "active"].includes(chat.status)) {
            global.notificationGateway.io.to(`chat:${roomId}`).emit("chat:status:changed", {
              chatId: roomId,
              status: "agent_handling",
              botActive: false,
            });
          }
        } catch (err) {
          console.error("Failed to broadcast message:", err.message);
        }
      });
    }

    // PERF-OPT 1 + 3: Trigger chatbot response via background job (fire-and-forget, no 700ms delay)
    // Queue the bot response instead of doing it inline. This prevents LLM latency from blocking
    // the user's message response. The socket:thinking_start indicator tells the UI the bot is working.
    const updatedBotActive = didReopen ? true : (!chat.metadata || chat.metadata.botActive !== false);
    if (senderRole === "customer" && updatedBotActive) {
      try {
        // Get admin/bot user record (system agent)
        const botUser = await User.findOne({ role: "admin" }).select("_id email");
        const botUserId = botUser ? botUser._id : senderId;

        // Queue the bot response processing via BullMQ
        const { queueDocumentIngestion } = require("./notificationQueue");
        // Reuse the BullMQ infrastructure to queue this bot response job
        // For now, fire-and-forget since we don't have a dedicated bot response queue
        // TODO: Create a dedicated botResponse queue for better reliability
        
        (async () => {
          try {
            // AI reads the customer's message right before processing it
            await ChatMessage.markAsRead(chatId, "admin");
            await Chat.findByIdAndUpdate(chatId, { lastReadAdminAt: new Date() });

            if (global.notificationGateway) {
              const roomId = chatId.toString();
              global.notificationGateway.io.to(`chat:${roomId}`).emit("chat:messages:read", {
                chatId: roomId,
                userId: botUserId,
                userRole: "admin",
              });
            }

            // PERF-OPT 3: No 700ms await — socket emission is already instant

            // Call Orchestrator — it owns the ai:thinking_start/stop/error indicator lifecycle
            const chatOrchestrator = require("./chatOrchestrator");
            const customerUser = await User.findById(senderId).select("email");
            const customerEmail = customerUser ? customerUser.email : null;
            const customerId = senderId ? senderId.toString() : null;

            const responseText = await chatOrchestrator.handleUserMessage(
              chatId, content, customerEmail, customerId
            );

            await this.sendMessage(chatId, botUserId, "bot", {
              content: responseText
            });
          } catch (error) {
            console.error("[PERF-OPT-3] Chatbot processing error:", error.message);
            // Emit error to user via socket
            if (global.notificationGateway) {
              global.notificationGateway.io.to(`chat:${chatId.toString()}`).emit("ai:error", {
                chatId: chatId.toString(),
                error: "Processing failed",
              });
            }
          }
        })();
      } catch (error) {
        console.error("[PERF-OPT-3] Failed to queue bot response:", error.message);
      }
    }

    return message.populate("sender", "firstName lastName email role avatar");
  }

  async getChatMessages(chatId, userId, userRole, options = {}) {
    const chat = await Chat.findOne({
      _id: chatId,
      deletedAt: null,
    });

    if (!chat) {
      throw new AppError("Chat not found", 404);
    }

    if (userRole !== "admin" && chat.customer.toString() !== userId.toString()) {
      throw new AppError("You are not authorized to view these messages", 403);
    }

    return ChatMessage.getChatMessages(chatId, options);
  }

  async markMessagesAsRead(chatId, userId, userRole) {
    const chat = await Chat.findOne({
      _id: chatId,
      deletedAt: null,
    });

    if (!chat) {
      throw new AppError("Chat not found", 404);
    }

    if (userRole !== "admin" && chat.customer.toString() !== userId.toString()) {
      throw new AppError("You are not authorized to mark these messages", 403);
    }

    // Mark individual messages read in ChatMessage documents
    const modifiedCount = await ChatMessage.markAsRead(chatId, userRole);

    // CHAT-FIXES-8 Fix 1: Update lastReadAt timestamp — this is the single source of truth.
    // Derived unread counts: count(messages.createdAt > lastReadAt) will now return 0.
    const now = new Date();
    if (userRole === "customer") {
      await Chat.findByIdAndUpdate(chatId, {
        lastReadCustomerAt: now,
        unreadCountCustomer: 0,
      });
    } else {
      await Chat.findByIdAndUpdate(chatId, {
        lastReadAdminAt: now,
        unreadCountAdmin: 0,
      });
    }

    // Broadcast read status via socket
    if (global.notificationGateway) {
      const roomId = chatId.toString();
      global.notificationGateway.io.to(`chat:${roomId}`).emit("chat:messages:read", {
        chatId: roomId,
        userId,
        userRole,
        readAt: now,
      });
    }

    return { modifiedCount };
  }

  async updateTypingStatus(chatId, userId, userRole, isTyping) {
    const chat = await Chat.findOne({
      _id: chatId,
      deletedAt: null,
    });

    if (!chat) {
      throw new AppError("Chat not found", 404);
    }

    if (userRole !== "admin" && chat.customer.toString() !== userId.toString()) {
      throw new AppError("You are not authorized to update this chat", 403);
    }

    const updateField =
      userRole === "customer" ? "customerTyping" : "adminTyping";

    await Chat.findByIdAndUpdate(chatId, {
      [updateField]: isTyping,
    });

    // Broadcast typing status via socket
    if (global.notificationGateway) {
      const roomId = chatId.toString();
      global.notificationGateway.io.to(`chat:${roomId}`).emit("chat:typing:status", {
        chatId: roomId,
        isTyping,
        userRole,
      });
    }

    return { success: true };
  }

  async closeChat(chatId, userId, userRole) {
    const chat = await Chat.findOne({
      _id: chatId,
      deletedAt: null,
    });

    if (!chat) {
      throw new AppError("Chat not found", 404);
    }

    if (userRole !== "admin" && chat.customer.toString() !== userId) {
      throw new AppError("You are not authorized to close this chat", 403);
    }

    chat.status = "closed";
    chat.closedBy = userId;
    await chat.save();

    // Broadcast close event via socket
    if (global.notificationGateway) {
      const roomId = chatId.toString();
      global.notificationGateway.io.to(`chat:${roomId}`).emit("chat:closed", {
        chatId: roomId,
        closedBy: userId,
        closedAt: new Date(),
      });
    }

    return chat;
  }

  async resolveChat(chatId, userId) {
    const chat = await Chat.findOne({
      _id: chatId,
      deletedAt: null,
    });

    if (!chat) {
      throw new AppError("Chat not found", 404);
    }

    chat.status = "resolved";
    chat.closedBy = userId;
    await chat.save();

    // Broadcast resolve event via socket
    if (global.notificationGateway) {
      const roomId = chatId.toString();
      global.notificationGateway.io.to(`chat:${roomId}`).emit("chat:resolved", {
        chatId: roomId,
        resolvedBy: userId,
        resolvedAt: new Date(),
      });
    }

    return chat;
  }

  async getChatStats() {
    const [totalChats, aiHandlingChats, escalatedChats, agentHandlingChats, resolvedChats, closedChats] =
      await Promise.all([
        Chat.countDocuments({ deletedAt: null }),
        Chat.countDocuments({ status: "ai_handling", deletedAt: null }),
        Chat.countDocuments({ status: "escalated", deletedAt: null }),
        Chat.countDocuments({ status: "agent_handling", deletedAt: null }),
        Chat.countDocuments({ status: "resolved", deletedAt: null }),
        Chat.countDocuments({ status: "closed", deletedAt: null }),
      ]);

    const chatsWithResponses = await Chat.aggregate([
      {
        $match: {
          status: { $in: ["ai_handling", "escalated", "agent_handling", "resolved", "closed"] },
          deletedAt: null,
        },
      },
      {
        $lookup: {
          from: "chatmessages",
          localField: "_id",
          foreignField: "chat",
          as: "messages",
        },
      },
      {
        $project: {
          createdAt: 1,
          firstAdminMessage: {
            $arrayElemAt: [
              {
                $filter: {
                  input: "$messages",
                  as: "msg",
                  cond: { $eq: ["$$msg.senderRole", "admin"] },
                },
              },
              0,
            ],
          },
        },
      },
      {
        $match: {
          "firstAdminMessage.createdAt": { $exists: true },
        },
      },
      {
        $project: {
          responseTime: {
            $subtract: ["$firstAdminMessage.createdAt", "$createdAt"],
          },
        },
      },
      {
        $group: {
          _id: null,
          avgResponseTime: { $avg: "$responseTime" },
        },
      },
    ]);

    const avgResponseTimeMs =
      chatsWithResponses.length > 0
        ? chatsWithResponses[0].avgResponseTime
        : null;
    const avgResponseTimeMinutes = avgResponseTimeMs
      ? Math.round(avgResponseTimeMs / 1000 / 60)
      : null;

    return {
      totalChats,
      waitingChats,
      activeChats,
      resolvedChats,
      closedChats,
      avgResponseTimeMinutes,
    };
  }

  async getUnreadCount(chatId, userRole) {
    return ChatMessage.getUnreadCount(chatId, userRole);
  }

  // ---------------------------------------------------------------------------
  // Support hours helper (CHAT-FIXES-8 Fix 2)
  // ---------------------------------------------------------------------------
  _isSupportOnline() {
    const now = new Date();
    const hour = now.getHours(); // server local time
    return hour >= 9 && hour < 18; // 9 AM – 6 PM
  }

  async toggleBot(chatId, userId, role, botActive) {
    const chat = await Chat.findOne({ _id: chatId, deletedAt: null });
    if (!chat) {
      throw new AppError("Chat not found", 404);
    }

    if (role !== "admin" && chat.customer.toString() !== userId.toString()) {
      throw new AppError("You are not authorized to update this chat", 403);
    }

    chat.metadata = {
      ...(chat.metadata || {}),
      botActive: botActive,
    };

    if (!botActive) {
      chat.status = "escalated"; // Escalate to human queue
      chat.metadata.escalatedAt = new Date();
      chat.metadata.escalationReason = "customer switched to human agent";
    } else {
      chat.status = "ai_handling";
    }

    await chat.save();

    // On escalation (bot deactivated by customer), post an instant, templated system acknowledgment
    if (!botActive) {
      try {
        // Context-aware acknowledgment based on support hours
        const online = this._isSupportOnline();
        const availabilityLine = online
          ? "An agent will be with you shortly."
          : "Our support team is currently offline. Our hours are 9:00 AM to 6:00 PM — we'll respond as soon as we're back online, and you'll be notified here.";

        const ackContent = `Thanks for reaching out — I've let our support team know you'd like to speak with someone, and you're in the queue. Feel free to add any extra details here in the meantime. ${availabilityLine}`;

        // Find bot/admin sender for system message
        const botUser = await User.findOne({ role: "admin" }).select("_id");
        if (botUser) {
          await ChatMessage.create({
            chat: chatId,
            sender: botUser._id,
            senderRole: "bot",
            isAiGenerated: true,
            messageType: "text",
            content: ackContent,
            deliveredAt: new Date(),
          });

          // Broadcast the acknowledgment message via socket
          if (global.notificationGateway) {
            const roomId = chatId.toString();
            const ackMsg = await ChatMessage.findOne({ chat: chatId, content: ackContent })
              .sort({ createdAt: -1 })
              .populate("sender", "firstName lastName email role avatar");
            if (ackMsg) {
              global.notificationGateway.io.to(`chat:${roomId}`).emit("chat:message:new", {
                chatId: roomId,
                message: ackMsg.toObject(),
                timestamp: new Date(),
              });
            }
          }
        }
      } catch (err) {
        console.error("[CHAT-FIXES-9] Failed to send escalation acknowledgment message:", err.message);
      }
    }

    // Broadcast status change
    if (global.notificationGateway) {
      const roomId = chatId.toString();
      global.notificationGateway.io.to(`chat:${roomId}`).emit("chat:status:changed", {
        chatId: roomId,
        status: chat.status,
        botActive: botActive,
      });
    }

    return chat;
  }
}

module.exports = new ChatService();
