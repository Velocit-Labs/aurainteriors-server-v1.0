const mongoose = require("mongoose");

const orderAddressSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true },
    phone: { type: String, required: true },
    addressLine1: { type: String, required: true },
    addressLine2: String,
    city: { type: String, required: true },
    state: String,
    postalCode: { type: String, required: true },
    country: { type: String, default: "Nepal" },
  },
  { _id: false }
);

const orderItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    name: { type: String, required: true },
    price: { type: Number, required: true },
    quantity: { type: Number, required: true, min: 1 },
    variant: {
      color: String,
      size: String,
      material: String,
    },
    image: String,
  },
  { _id: true }
);

const orderSchema = new mongoose.Schema(
  {
    orderId: {
      type: String,
      unique: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    guestInfo: {
      email: { type: String, required: true },
      firstName: String,
      lastName: String,
      phone: String,
    },
    isGuestOrder: {
      type: Boolean,
      default: false,
    },
    items: [orderItemSchema],
    shippingAddress: {
      type: orderAddressSchema,
      required: true,
    },
    billingAddress: orderAddressSchema,
    subtotal: { type: Number, required: true },
    discountAmount: { type: Number, default: 0 },
    shippingCost: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },
    total: { type: Number, required: true },
    discountCode: {
      code: String,
      percentage: Number,
    },
    paymentMethod: {
      type: String,
      enum: ["cod", "esewa"],
      required: true,
    },
    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "failed", "refunded"],
      default: "pending",
    },
    paymentDetails: {
      transactionId: String,
      esewaRefId: String,
      paidAt: Date,
      paymentGatewayResponse: mongoose.Schema.Types.Mixed,
    },
    orderStatus: {
      type: String,
      enum: [
        "pending",
        "confirmed",
        "processing",
        "shipped",
        "delivered",
        "cancelled",
      ],
      default: "pending",
    },
    returnRequest: {
      status: {
        type: String,
        enum: ["none", "requested", "approved", "rejected", "completed"],
        default: "none",
      },
      reason: String,
      description: String,
      requestedAt: Date,
      processedAt: Date,
      adminNote: String,
    },
    statusHistory: [
      {
        status: String,
        timestamp: { type: Date, default: Date.now },
        note: String,
      },
    ],
    orderedAt: { type: Date, default: Date.now },
    confirmedAt: Date,
    shippedAt: Date,
    deliveredAt: Date,
    cancelledAt: Date,
    customerNote: String,
    adminNote: String,
    idempotencyKey: { type: String, unique: true, sparse: true },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ "guestInfo.email": 1 });
orderSchema.index({ orderStatus: 1 });
orderSchema.index({ paymentStatus: 1 });
orderSchema.index({ createdAt: -1 });
orderSchema.index({ idempotencyKey: 1 });

orderSchema.pre("save", function () {
  if (this.isNew && !this.orderId) {
    const prefix = "AU";
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    this.orderId = `${prefix}${timestamp}${random}`;
  }
});

orderSchema.methods.addStatusHistory = function (status, note = "") {
  this.statusHistory.push({ status, note, timestamp: new Date() });
  this.orderStatus = status;
  return this;
};

orderSchema.statics.findByOrderIdAndEmail = async function (orderId, email) {
  return this.findOne({
    orderId: orderId.toUpperCase(),
    "guestInfo.email": email.toLowerCase(),
  });
};

const Order = mongoose.model("Order", orderSchema);

module.exports = Order;
