const mongoose = require("mongoose");

const chatSchema = new mongoose.Schema(
  {
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Chat must have a customer"],
      index: true,
    },
    status: {
      type: String,
      enum: ["ai_handling", "escalated", "agent_handling", "resolved", "closed"],
      default: "ai_handling",
      index: true,
    },
    subject: {
      type: String,
      maxlength: 200,
      trim: true,
    },
    priority: {
      type: String,
      enum: ["low", "normal", "high", "urgent"],
      default: "normal",
    },
    lastMessageAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    unreadCountCustomer: {
      type: Number,
      default: 0,
      min: 0,
    },
    unreadCountAdmin: {
      type: Number,
      default: 0,
      min: 0,
    },
    lastReadCustomerAt: {
      type: Date,
      default: Date.now,
    },
    lastReadAdminAt: {
      type: Date,
      default: Date.now,
    },
    customerTyping: {
      type: Boolean,
      default: false,
    },
    adminTyping: {
      type: Boolean,
      default: false,
    },
    metadata: {
      userAgent: String,
      ipAddress: String,
      referrer: String,
      sentiment: String,
      confidence: Number,
    },
    adminNotes: [
      {
        author: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        content: String,
        createdAt: {
          type: Date,
          default: Date.now,
        },
      }
    ],
    closedAt: {
      type: Date,
      default: null,
    },
    closedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

chatSchema.index({ customer: 1, status: 1 });
chatSchema.index({ createdAt: -1 });
chatSchema.index({ lastMessageAt: -1 });
chatSchema.index({ status: 1, lastMessageAt: -1 });

chatSchema.virtual("isActive").get(function () {
  return ["ai_handling", "escalated", "agent_handling"].includes(this.status);
});

chatSchema.virtual("messages", {
  ref: "ChatMessage",
  localField: "_id",
  foreignField: "chat",
});

chatSchema.pre("save", function () {
  if (this.isModified("status")) {
    if (
      (this.status === "closed" || this.status === "resolved") &&
      !this.closedAt
    ) {
      this.closedAt = new Date();
    }
  }
});

chatSchema.statics.getCustomerChats = async function (
  customerId,
  options = {}
) {
  const { limit = 20, page = 1, status } = options;
  const skip = (page - 1) * limit;

  const query = {
    customer: customerId,
    deletedAt: null,
  };

  if (status) {
    query.status = status;
  }

  const [chats, total] = await Promise.all([
    this.find(query).sort({ lastMessageAt: -1 }).skip(skip).limit(limit).lean(),
    this.countDocuments(query),
  ]);

  return {
    chats,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
};

chatSchema.statics.getAllChats = async function (options = {}) {
  const {
    limit = 20,
    page = 1,
    status,
    priority,
    sortBy = "lastMessageAt",
  } = options;
  const skip = (page - 1) * limit;

  const query = {
    deletedAt: null,
  };

  if (status) {
    query.status = status;
  }

  if (priority) {
    query.priority = priority;
  }

  const sortOptions = {};
  sortOptions[sortBy] = -1;

  const [chats, total] = await Promise.all([
    this.find(query)
      .sort(sortOptions)
      .skip(skip)
      .limit(limit)
      .populate("customer", "firstName lastName email")
      .lean(),
    this.countDocuments(query),
  ]);

  return {
    chats,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
};

chatSchema.statics.getWaitingQueue = async function () {
  return this.find({
    status: "escalated",
    deletedAt: null,
  })
    .sort({ createdAt: 1 })
    .populate("customer", "firstName lastName email")
    .lean();
};

module.exports = mongoose.model("Chat", chatSchema);
