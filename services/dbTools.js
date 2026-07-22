const mongoose = require("mongoose");
const Product = require("../models/product.model");
const Category = require("../models/category.model");
const Order = require("../models/order.model");
const Address = require("../models/address.model");
const User = require("../models/user.model");

class DbTools {
  /**
   * Search product catalog
   */
  async searchProducts({ query, categoryName, limit = 5 }) {
    try {
      const dbQuery = { status: "active" };

      if (categoryName) {
        const category = await Category.findOne({
          name: { $regex: new RegExp(categoryName, "i") },
        });
        if (category) {
          dbQuery.category = category._id;
        }
      }

      if (query) {
        dbQuery.$or = [
          { name: { $regex: new RegExp(query, "i") } },
          { sku: { $regex: new RegExp(query, "i") } },
          { description: { $regex: new RegExp(query, "i") } },
        ];
      }

      const products = await Product.find(dbQuery)
        .limit(Number(limit))
        .select("name price originalPrice stock sku status description slug")
        .populate("category", "name")
        .lean();

      return products.map((p) => ({
        id: p._id.toString(),
        name: p.name,
        price: p.price,
        originalPrice: p.originalPrice,
        stock: p.stock,
        sku: p.sku,
        status: p.status,
        category: p.category?.name,
        shortDescription: p.description?.substring(0, 150) + "...",
        // FIX 1: Use canonical singular /product/ and the real slug instead of raw ID
        url: `/product/${p.slug || p._id}`,
      }));
    } catch (error) {
      console.error("DbTools searchProducts error:", error.message);
      return [];
    }
  }

  /**
   * Get detailed product specifications
   */
  async getProductDetails({ sku, productId }) {
    try {
      const dbQuery = {};
      if (productId) dbQuery._id = productId;
      else if (sku) dbQuery.sku = sku.toUpperCase();
      else return { error: "Either sku or productId must be provided" };

      const product = await Product.findOne(dbQuery)
        .populate("category", "name")
        .lean();

      if (!product) return { error: "Product not found" };

      return {
        id: product._id.toString(),
        name: product.name,
        sku: product.sku,
        price: product.price,
        stock: product.stock,
        status: product.status,
        category: product.category?.name,
        description: product.description,
        dimensions: product.dimensions,
        // FIX 1: Use canonical singular /product/ and the real slug instead of raw ID
        url: `/product/${product.slug || product._id}`,
      };
    } catch (error) {
      console.error("DbTools getProductDetails error:", error.message);
      return { error: "Failed to retrieve product details" };
    }
  }

  /**
   * Retrieve order status securely.
   */
  async getOrderStatus({ orderId, email, userId }) {
    try {
      // --- Logged-in customer path ---
      if (userId) {
        const query = { user: userId };
        if (orderId) {
          // Specific order requested
          const order = await Order.findOne({
            $or: [
              { orderId, user: userId },
              ...(mongoose.isValidObjectId(orderId) ? [{ _id: orderId, user: userId }] : []),
            ],
          }).lean();

          if (!order) return { error: "Order not found for your account" };
          return this._formatOrder(order);
        }

        // No orderId — return the 3 most recent orders for the customer to choose from
        const orders = await Order.find(query)
          .sort({ createdAt: -1 })
          .limit(3)
          .lean();

        if (orders.length === 0) return { error: "No orders found for your account" };
        if (orders.length === 1) return this._formatOrder(orders[0]);

        return {
          message: "Here are your most recent orders. Please specify an order ID for more details.",
          orders: orders.map((o) => ({
            orderId: o.orderId,
            status: o.orderStatus,
            total: o.total,
            itemCount: o.items.length,
            createdAt: o.createdAt,
          })),
        };
      }

      // --- Guest path: require both orderId and email ---
      if (!orderId || !email) {
        return { error: "Please provide your order ID and the email address used when placing the order to look up your order status." };
      }

      const order = await Order.findOne({
        $or: [
          { orderId },
          ...(mongoose.isValidObjectId(orderId) ? [{ _id: orderId }] : []),
        ],
      }).populate("user", "email").lean();

      if (!order) return { error: "Order not found" };

      const orderEmail = order.isGuestOrder ? order.guestInfo?.email : order.user?.email;
      if (!orderEmail || orderEmail.toLowerCase() !== email.toLowerCase()) {
        return { error: "Email verification failed for this order. You are not authorized to view this order's status." };
      }

      return this._formatOrder(order);
    } catch (error) {
      console.error("DbTools getOrderStatus error:", error.message);
      return { error: "Failed to retrieve order status" };
    }
  }

  /**
   * Retrieve order history for logged-in user (read-only).
   */
  async getOrderHistory({ userId }) {
    try {
      if (!userId) return { error: "User context not available." };
      const orders = await Order.find({ user: userId }).sort({ createdAt: -1 }).lean();
      return orders.map(o => this._formatOrder(o));
    } catch (error) {
      console.error("DbTools getOrderHistory error:", error.message);
      return [];
    }
  }

  /**
   * Retrieve default address for logged-in user (read-only).
   */
  async getDefaultAddress({ userId }) {
    try {
      if (!userId) return { error: "User context not available." };
      const address = await Address.findOne({ user: userId, isDefault: true }).lean();
      if (address) return address;

      const fallback = await Address.findOne({ user: userId }).lean();
      return fallback || null;
    } catch (error) {
      console.error("DbTools getDefaultAddress error:", error.message);
      return null;
    }
  }

  /**
   * Retrieve all saved addresses for logged-in user (read-only).
   */
  async getSavedAddresses({ userId }) {
    try {
      if (!userId) return { error: "User context not available." };
      const addresses = await Address.find({ user: userId }).lean();
      return addresses;
    } catch (error) {
      console.error("DbTools getSavedAddresses error:", error.message);
      return [];
    }
  }

  /**
   * Retrieve customer profile information (read-only).
   */
  async getProfileInfo({ userId }) {
    try {
      if (!userId) return { error: "User context not available." };
      const user = await User.findById(userId).select("firstName lastName email role phone createdAt").lean();
      if (!user) return { error: "User profile not found" };
      return {
        fullName: `${user.firstName} ${user.lastName}`,
        email: user.email,
        phone: user.phone || "Not provided",
        memberSince: user.createdAt,
      };
    } catch (error) {
      console.error("DbTools getProfileInfo error:", error.message);
      return { error: "Failed to retrieve profile information" };
    }
  }

  _formatOrder(order) {
    return {
      orderId: order.orderId,
      status: order.orderStatus,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      total: order.total,
      shippingAddress: {
        fullName: order.shippingAddress?.fullName,
        phone: order.shippingAddress?.phone,
        addressLine1: order.shippingAddress?.addressLine1,
        addressLine2: order.shippingAddress?.addressLine2,
        city: order.shippingAddress?.city,
        country: order.shippingAddress?.country,
      },
      items: order.items.map((item) => ({
        name: item.name,
        quantity: item.quantity,
        price: item.price,
      })),
      createdAt: order.createdAt,
    };
  }
}

module.exports = new DbTools();
