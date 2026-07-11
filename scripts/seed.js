require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../models/user.model");
const Category = require("../models/category.model");
const Product = require("../models/product.model");
const Order = require("../models/order.model");

const connectDB = async () => {
  try {
    const mongoUri = process.env.MONGO_URI || "mongodb://localhost:27017/aura-interiors";
    await mongoose.connect(mongoUri);
    console.log("✓ Connected to MongoDB for seeding...");
  } catch (error) {
    console.error("MongoDB connection failed:", error);
    process.exit(1);
  }
};

const furnitureImages = {
  sofas: [
    "https://images.unsplash.com/photo-1494526585095-c41746248156?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1513694203232-719a280e022f?auto=format&fit=crop&w=1200&q=80"
  ],
  beds: [
    "https://images.unsplash.com/photo-1484154218962-a197022b5858?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1532372320572-cda25653a26d?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1617806118233-18e1de247200?auto=format&fit=crop&w=1200&q=80"
  ],
  dining: [
    "https://images.unsplash.com/photo-1494526585095-c41746248156?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=1200&q=80"
  ],
  chairs: [
    "https://images.unsplash.com/photo-1513694203232-719a280e022f?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1484154218962-a197022b5858?auto=format&fit=crop&w=1200&q=80"
  ],
  decor: [
    "https://images.unsplash.com/photo-1532372320572-cda25653a26d?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1617806118233-18e1de247200?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1494526585095-c41746248156?auto=format&fit=crop&w=1200&q=80"
  ],
  lighting: [
    "https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1513694203232-719a280e022f?auto=format&fit=crop&w=1200&q=80"
  ]
};

const runSeeder = async () => {
  try {
    await connectDB();

    // 1. Seed Admin User if not exists
    console.log("Checking Admin User...");
    const adminEmail = process.env.ADMIN_EMAIL || "admin@aurainteriors.com";
    let adminUser = await User.findOne({ email: adminEmail });
    if (!adminUser) {
      adminUser = new User({
        firstName: "Admin",
        lastName: "User",
        email: adminEmail,
        password: "password123",
        role: "admin",
        phone: "9800000000",
        isEmailVerified: true,
        isActive: true,
      });
      await adminUser.save();
      console.log(`✓ Admin user created: ${adminEmail} (password123)`);
    } else {
      adminUser.password = "password123";
      await adminUser.save();
      console.log(`✓ Admin user exists: ${adminEmail} (password updated)`);
    }

    // 2. Seed Customer User if not exists
    console.log("Checking Customer User...");
    const customerEmail = "customer@aurainteriors.com";
    let customerUser = await User.findOne({ email: customerEmail });
    if (!customerUser) {
      customerUser = new User({
        firstName: "Saugat",
        lastName: "Shahi",
        email: customerEmail,
        password: "password123",
        role: "customer",
        phone: "9877665544",
        isEmailVerified: true,
        isActive: true,
      });
      await customerUser.save();
      console.log(`✓ Customer user created: ${customerEmail} (password123)`);
    } else {
      customerUser.password = "password123";
      await customerUser.save();
      console.log(`✓ Customer user exists: ${customerEmail} (password updated)`);
    }

    // 3. Clear existing catalog data
    console.log("Clearing catalog data (Categories, Products, Orders)...");
    await Category.deleteMany({});
    await Product.deleteMany({});
    await Order.deleteMany({});

    // 4. Create Categories
    console.log("Creating categories...");
    const categoriesData = [
      { name: "Living Room", description: "Designer sofas and accent chairs for a statement living space.", image: furnitureImages.sofas[0], sortOrder: 1 },
      { name: "Bedroom", description: "Premium beds and nightstands for the ultimate sleep experience.", image: furnitureImages.beds[0], sortOrder: 2 },
      { name: "Dining", description: "Elegant dining sets and sideboards for shared moments.", image: furnitureImages.dining[0], sortOrder: 3 },
      { name: "Lighting", description: "Sculptural lighting to illuminate your home with style.", image: furnitureImages.lighting[0], sortOrder: 4 },
      { name: "Decor", description: "Curated objects and wall art for the finishing touch.", image: furnitureImages.decor[0], sortOrder: 5 }
    ];
    const createdCategories = await Category.create(categoriesData);
    const catMap = {};
    createdCategories.forEach(c => catMap[c.name] = c._id);
    console.log(`✓ Created ${createdCategories.length} categories.`);

    // 5. Create Products
    console.log("Creating premium catalog products...");
    const productsData = [
      {
        name: "Aura Sheesham Wood 3 Seater Sofa Cum Bed",
        description: "A versatile space-saving solution crafted from premium sheesham wood with intricate cane work and luxurious upholstery. This piece seamlessly transitions from a sophisticated sofa to a comfortable bed for guests.",
        shortDescription: "Space-saving sheesham wood sofa with traditional cane weaving.",
        price: 65999,
        originalPrice: 146999,
        stock: 15,
        category: catMap["Living Room"],
        images: [{ url: furnitureImages.sofas[0], isPrimary: true }],
        colors: ["Walnut", "Natural"],
        materials: ["Sheesham Wood", "Cane"],
        style: "modern",
        arAvailable: true,
        dimensions: { width: 190, height: 85, depth: 95, unit: "cm" },
        warranty: "5-Year Structural Warranty",
        shippingInfo: "Ships in 7-10 business days. Includes professional assembly.",
        rating: { average: 4.8, count: 126 }
      },
      {
        name: "Albus 3 Seater Fabric Sofa (Jade Ivory)",
        description: "Plush cotton upholstery in a sophisticated ivory tone, perfect for modern minimalist living rooms and open spaces. The Albus sofa offers deep seating comfort with a slim profile.",
        shortDescription: "Minimalist cotton sofa in sophisticated ivory tone.",
        price: 37999,
        originalPrice: 63999,
        stock: 22,
        category: catMap["Living Room"],
        images: [{ url: furnitureImages.sofas[1], isPrimary: true }],
        colors: ["Jade Ivory", "Storm Gray"],
        materials: ["Cotton Fabric", "Pine Wood"],
        style: "minimal",
        arAvailable: true,
        dimensions: { width: 210, height: 80, depth: 90, unit: "cm" },
        rating: { average: 4.7, count: 48 }
      },
      {
        name: "Avira Premium Lounge Chair (Salmon Pink)",
        description: "A vibrant statement piece featuring ergonomic support and luxurious salmon pink fabric for a touch of elegance. Ideal for reading corners or as an accent piece in your master suite.",
        shortDescription: "Vibrant salmon pink lounge chair with ergonomic support.",
        price: 14999,
        originalPrice: 31999,
        stock: 35,
        category: catMap["Living Room"],
        images: [{ url: furnitureImages.chairs[0], isPrimary: true }],
        colors: ["Salmon Pink", "Emerald Green"],
        materials: ["Velvet", "Metal"],
        style: "contemporary",
        dimensions: { width: 75, height: 105, depth: 80, unit: "cm" },
        rating: { average: 4.9, count: 15 }
      },
      {
        name: "Calmora Solid Wood Bed with Upholstered Headboard",
        description: "Ergonomically designed for comfort with a premium upholstered headboard and spacious storage. Handcrafted from solid wood with a rich walnut finish.",
        shortDescription: "Solid wood bed frame with plush headboard and storage.",
        price: 45999,
        originalPrice: 89999,
        stock: 10,
        category: catMap["Bedroom"],
        images: [{ url: furnitureImages.beds[0], isPrimary: true }],
        colors: ["Walnut"],
        materials: ["Solid Wood", "Linen"],
        style: "modern",
        arAvailable: true,
        rating: { average: 4.6, count: 82 }
      },
      {
        name: "Eka Nightstand with Dual Drawers",
        description: "A sleek, minimalist nightstand featuring smooth-gliding dual drawers and a hidden cable management port. Perfect for keeping your bedside essentials organized.",
        shortDescription: "Minimalist bedside table with ample storage.",
        price: 8499,
        originalPrice: 15999,
        stock: 50,
        category: catMap["Bedroom"],
        images: [{ url: furnitureImages.decor[0], isPrimary: true }],
        colors: ["Natural Oak", "Charcoal"],
        materials: ["Engineered Wood", "Metal"],
        style: "minimal",
        rating: { average: 4.5, count: 34 }
      },
      {
        name: "Luxe 6-Seater Marble Dining Table",
        description: "Make every meal a grand affair with this stunning white marble top table supported by architectural black steel legs. Durable, heat-resistant, and timeless.",
        shortDescription: "Grand white marble dining table with steel legs.",
        price: 89999,
        originalPrice: 159999,
        stock: 5,
        category: catMap["Dining"],
        images: [{ url: furnitureImages.dining[0], isPrimary: true }],
        materials: ["Marble", "Steel"],
        style: "modern",
        arAvailable: true,
        rating: { average: 4.9, count: 12 }
      },
      {
        name: "Hygge Upholstered Dining Chair (Set of 2)",
        description: "Experience Scandi-comfort with these padded dining chairs featuring curved backrests and tapered wooden legs. Upholstered in spill-resistant fabric.",
        shortDescription: "Comfortable Scandi-style dining chairs, spill-resistant.",
        price: 12999,
        originalPrice: 24999,
        stock: 40,
        category: catMap["Dining"],
        images: [{ url: furnitureImages.chairs[1], isPrimary: true }],
        colors: ["Mist Gray", "Sand"],
        materials: ["Ash Wood", "Performance Fabric"],
        style: "scandinavian",
        rating: { average: 4.8, count: 56 }
      },
      {
        name: "Solis Industrial Pendant Chandelier",
        description: "An architectural lighting piece featuring raw metal finishes and exposed Edison-style bulbs. Perfect for kitchen islands and dining areas.",
        shortDescription: "Raw metal industrial chandelier for kitchen or dining.",
        price: 7499,
        originalPrice: 14999,
        stock: 25,
        category: catMap["Lighting"],
        images: [{ url: furnitureImages.lighting[0], isPrimary: true }],
        materials: ["Iron", "Glass"],
        style: "industrial",
        rating: { average: 4.7, count: 28 }
      },
      {
        name: "Nova Adjustable Floor Lamp",
        description: "A versatile task light with a sleek gold finish and an adjustable boom arm. Ideal for reading corners and home offices.",
        shortDescription: "Elegant gold floor lamp with adjustable task lighting.",
        price: 6499,
        originalPrice: 12999,
        stock: 18,
        category: catMap["Lighting"],
        images: [{ url: furnitureImages.lighting[1], isPrimary: true }],
        colors: ["Gold", "Matte Black"],
        materials: ["Brass", "Marble"],
        style: "modern",
        rating: { average: 4.9, count: 42 }
      },
      {
        name: "Zen Handcrafted Ceramic Vases (Set of 3)",
        description: "A curated trio of organic-shaped vases in varying sizes. Features a unique reactive glaze that makes every piece one-of-a-kind.",
        shortDescription: "Organic handcrafted ceramic vases with reactive glaze.",
        price: 3499,
        originalPrice: 6999,
        stock: 60,
        category: catMap["Decor"],
        images: [{ url: furnitureImages.decor[1], isPrimary: true }],
        colors: ["Teracotta", "Stone"],
        materials: ["Ceramic"],
        style: "bohemian",
        rating: { average: 4.6, count: 94 }
      },
      {
        name: "Eclipse Round Brass Wall Mirror",
        description: "Create an illusion of space with this large, thin-frame round mirror. Hand-polished brass finish adds a touch of warmth to any hallway or bedroom.",
        shortDescription: "Large round wall mirror with hand-polished brass frame.",
        price: 11999,
        originalPrice: 19999,
        stock: 12,
        category: catMap["Decor"],
        images: [{ url: furnitureImages.decor[2], isPrimary: true }],
        materials: ["Brass", "Glass"],
        style: "minimal",
        rating: { average: 4.8, count: 37 }
      }
    ];

    const createdProducts = await Product.create(productsData);
    console.log(`✓ Created ${createdProducts.length} premium products.`);

    // 6. Create historical simulated orders
    console.log("Generating simulated historical order records...");
    const orders = [];
    const numOrders = 20;
    const now = new Date();

    for (let i = 0; i < numOrders; i++) {
      const daysAgo = Math.floor(Math.random() * 60);
      const date = new Date(now);
      date.setDate(date.getDate() - daysAgo);

      const numItems = Math.floor(Math.random() * 3) + 1;
      const orderItems = [];
      let subtotal = 0;

      for (let j = 0; j < numItems; j++) {
        const prod = createdProducts[Math.floor(Math.random() * createdProducts.length)];
        const qty = Math.floor(Math.random() * 2) + 1;
        orderItems.push({
          product: prod._id,
          name: prod.name,
          price: prod.price,
          quantity: qty,
          image: prod.images[0].url
        });
        subtotal += prod.price * qty;
      }

      orders.push({
        user: customerUser._id,
        guestInfo: {
          email: customerUser.email,
          firstName: customerUser.firstName,
          lastName: customerUser.lastName,
          phone: customerUser.phone || "9800000000"
        },
        items: orderItems,
        shippingAddress: {
          fullName: `${customerUser.firstName} ${customerUser.lastName}`,
          phone: customerUser.phone || "9800000000",
          addressLine1: "Baneshwor-10",
          city: "Kathmandu",
          postalCode: "44600",
          country: "Nepal"
        },
        subtotal,
        total: subtotal,
        paymentMethod: i % 4 === 0 ? "esewa" : "cod",
        paymentStatus: i % 4 === 0 ? "paid" : "pending",
        orderStatus: i % 10 === 0 ? "delivered" : "processing",
        createdAt: date,
        orderedAt: date,
        isGuestOrder: false
      });
    }

    await Order.create(orders);
    console.log(`✓ Created ${orders.length} simulated orders.`);
    console.log("✓ Seeding finished successfully!");
    process.exit(0);
  } catch (error) {
    console.error("Seeding operation failed:", error);
    process.exit(1);
  }
};

runSeeder();
