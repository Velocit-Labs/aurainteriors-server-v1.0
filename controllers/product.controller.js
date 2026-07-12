const Product = require("../models/product.model");
const Category = require("../models/category.model");
const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/AppError");
const { deleteFile, deleteFiles } = require("../middleware/upload.middleware");

const parseJsonField = (field) => {
  if (!field) return undefined;
  if (typeof field === "string") {
    try {
      return JSON.parse(field);
    } catch {
      return field;
    }
  }
  return field;
};

const parseBoolean = (value) => {
  if (value === "true" || value === true) return true;
  if (value === "false" || value === false) return false;
  return undefined;
};

// Get all products with filtering, sorting, and pagination
exports.getAllProducts = catchAsync(async (req, res, next) => {
  const {
    page = 1,
    limit = 20,
    sort = "-createdAt",
    category,
    categories,
    status,
    style,
    minPrice,
    maxPrice,
    colors,
    materials,
    minRating,
    search,
    featured,
    newArrivals,
    inStock,
  } = req.query;

  // Build filter
  const filter = { deletedAt: null };

  // Handle category filter by ID (legacy)
  if (category) {
    const categoryIds = category.split(",");
    filter.category = { $in: categoryIds };
  }

  // Handle categories filter by slug (new)
  if (categories) {
    const categorySlugs = categories.split(",").filter(Boolean);
    if (categorySlugs.length > 0) {
      const categoryDocs = await Category.find({ slug: { $in: categorySlugs } }).select("_id");
      const categoryIds = categoryDocs.map((cat) => cat._id);
      if (categoryIds.length > 0) {
        filter.category = { $in: categoryIds };
      }
    }
  }

  if (status) {
    if (status === "all") {
      // Do not apply status filter to return all (active, out_of_stock, draft)
    } else if (status.includes(",")) {
      filter.status = { $in: status.split(",") };
    } else {
      filter.status = status;
    }
  } else {
    filter.status = { $in: ["active", "out_of_stock"] };
  }

  if (style) {
    const styles = style.split(",");
    filter.style = { $in: styles };
  }

  if (minPrice || maxPrice) {
    filter.price = {};
    if (minPrice) filter.price.$gte = parseFloat(minPrice);
    if (maxPrice) filter.price.$lte = parseFloat(maxPrice);
  }

  // Handle colors filter (case-insensitive)
  if (colors) {
    const colorList = colors.split(",").filter(Boolean);
    if (colorList.length > 0) {
      filter.colors = { $in: colorList.map((c) => new RegExp(`^${c}$`, "i")) };
    }
  }

  // Handle materials filter (case-insensitive)
  if (materials) {
    const materialList = materials.split(",").filter(Boolean);
    if (materialList.length > 0) {
      filter.materials = { $in: materialList.map((m) => new RegExp(`^${m}$`, "i")) };
    }
  }

  // Handle rating filter
  if (minRating) {
    filter["rating.average"] = { $gte: parseFloat(minRating) };
  }

  if (featured === "true") {
    filter.isFeatured = true;
  }

  if (newArrivals === "true") {
    filter.isNewArrival = true;
  }

  if (inStock === "true") {
    filter.stock = { $gt: 0 };
    filter.status = "active";
  }

  if (search) {
    filter.$text = { $search: search };
  }

  const pageNum = parseInt(page, 10);
  const limitNum = parseInt(limit, 10);
  const skip = (pageNum - 1) * limitNum;

  const [products, total] = await Promise.all([
    Product.find(filter).populate("category", "name slug").sort(sort).skip(skip).limit(limitNum),
    Product.countDocuments(filter),
  ]);

  res.status(200).json({
    status: "success",
    results: products.length,
    data: {
      products,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    },
  });
});

// Get single product by ID or slug
exports.getProduct = catchAsync(async (req, res, next) => {
  const { id } = req.params;

  const isObjectId = /^[0-9a-fA-F]{24}$/.test(id);
  const query = isObjectId ? { _id: id, deletedAt: null } : { slug: id, deletedAt: null };

  const product = await Product.findOne(query).populate("category", "name slug");

  if (!product) {
    return next(new AppError("Product not found", 404));
  }

  res.status(200).json({
    status: "success",
    data: {
      product,
    },
  });
});

// Create new product (Admin only)
exports.createProduct = catchAsync(async (req, res, next) => {
  const {
    name,
    description,
    shortDescription,
    category,
    price,
    originalPrice,
    stock,
    sku,
    status,
    modelUrl,
    modelUrls, // Array of external model URLs
    dimensions,
    weight,
    colors,
    materials,
    style,
    isFeatured,
    isNewArrival,
    metaTitle,
    metaDescription,
    tags,
  } = req.body;

  // Verify category exists
  const categoryExists = await Category.findById(category);
  if (!categoryExists) {
    return next(new AppError("Category not found", 400));
  }

  const productData = {
    name,
    description,
    shortDescription,
    category,
    price: parseFloat(price),
    originalPrice: originalPrice ? parseFloat(originalPrice) : undefined,
    stock: parseInt(stock, 10) || 0,
    sku,
    status: status || "active",
    modelUrl,
    style,
    isFeatured: parseBoolean(isFeatured) || false,
    isNewArrival: parseBoolean(isNewArrival) || false,
    metaTitle,
    metaDescription,
    dimensions: parseJsonField(dimensions),
    weight: parseJsonField(weight),
    colors: parseJsonField(colors),
    materials: parseJsonField(materials),
    tags: parseJsonField(tags),
  };

  const imageFiles = req.files?.images || (Array.isArray(req.files) ? req.files : []);
  if (imageFiles.length > 0) {
    productData.images = imageFiles.map((file, index) => ({
      url: file.cloudinaryUrl,
      publicId: file.cloudinaryPublicId,
      alt: name,
      isPrimary: index === 0,
    }));
  }

  // Initialize modelFiles array
  productData.modelFiles = [];

  if (req.files?.modelFiles && req.files.modelFiles.length > 0) {
    const uploadedModels = req.files.modelFiles.map((file) => ({
      url: file.cloudinaryUrl,
      publicId: file.cloudinaryPublicId,
      format: file.format,
      platform: file.platform,
      fileSize: file.fileSize,
      isExternal: false,
    }));
    productData.modelFiles.push(...uploadedModels);
  }

  // Handle external model URLs
  if (modelUrls) {
    const parsedUrls = parseJsonField(modelUrls) || [];
    const externalModels = parsedUrls.map((model) => ({
      url: model.url,
      format: model.format,
      platform: model.platform || (model.format === 'usdz' ? 'ios' : 'android'),
      isExternal: true,
    }));
    productData.modelFiles.push(...externalModels);
  }

  // Clean up empty modelFiles array
  if (productData.modelFiles.length === 0) {
    delete productData.modelFiles;
  }

  const product = await Product.create(productData);
  await product.populate("category", "name slug");

  res.status(201).json({
    status: "success",
    data: {
      product,
    },
  });
});

// Update product (Admin only)
exports.updateProduct = catchAsync(async (req, res, next) => {
  const product = await Product.findOne({ _id: req.params.id, deletedAt: null });

  if (!product) {
    return next(new AppError("Product not found", 404));
  }

  const {
    name,
    description,
    shortDescription,
    category,
    price,
    originalPrice,
    stock,
    sku,
    status,
    modelUrl,
    modelUrls, // Array of external model URLs to add
    dimensions,
    weight,
    colors,
    materials,
    style,
    isFeatured,
    isNewArrival,
    metaTitle,
    metaDescription,
    tags,
    removeImages,
    removeModelFiles,
  } = req.body;

  // Verify category if being updated
  if (category) {
    const categoryExists = await Category.findById(category);
    if (!categoryExists) {
      return next(new AppError("Category not found", 400));
    }
    product.category = category;
  }

  // Update basic fields
  if (name !== undefined) product.name = name;
  if (description !== undefined) product.description = description;
  if (shortDescription !== undefined) product.shortDescription = shortDescription;
  if (price !== undefined) product.price = parseFloat(price);
  if (originalPrice !== undefined) product.originalPrice = parseFloat(originalPrice);
  if (stock !== undefined) product.stock = parseInt(stock, 10);
  if (sku !== undefined) product.sku = sku;
  if (status !== undefined) product.status = status;
  if (modelUrl !== undefined) product.modelUrl = modelUrl;
  if (style !== undefined) product.style = style;

  const featuredValue = parseBoolean(isFeatured);
  const newArrivalValue = parseBoolean(isNewArrival);
  if (featuredValue !== undefined) product.isFeatured = featuredValue;
  if (newArrivalValue !== undefined) product.isNewArrival = newArrivalValue;

  if (metaTitle !== undefined) product.metaTitle = metaTitle;
  if (metaDescription !== undefined) product.metaDescription = metaDescription;

  // Parse and update JSON fields
  if (dimensions !== undefined) product.dimensions = parseJsonField(dimensions);
  if (weight !== undefined) product.weight = parseJsonField(weight);
  if (colors !== undefined) product.colors = parseJsonField(colors);
  if (materials !== undefined) product.materials = parseJsonField(materials);
  if (tags !== undefined) product.tags = parseJsonField(tags);

  if (removeImages) {
    const imagesToRemove = parseJsonField(removeImages) || [];
    const imagesToDelete = product.images.filter((img) => imagesToRemove.includes(img.url) && img.publicId);
    await Promise.all(imagesToDelete.map((img) => deleteFile(img.publicId)));
    product.images = product.images.filter((img) => !imagesToRemove.includes(img.url));
  }

  if (removeModelFiles) {
    const modelsToRemove = parseJsonField(removeModelFiles) || [];
    const modelsToDelete = product.modelFiles.filter(
      (model) => modelsToRemove.includes(model.url) && !model.isExternal && model.publicId
    );
    await Promise.all(modelsToDelete.map((model) => deleteFile(model.publicId, "raw")));
    product.modelFiles = product.modelFiles.filter((model) => !modelsToRemove.includes(model.url));
  }

  const imageFiles = req.files?.images || (Array.isArray(req.files) ? req.files : []);
  if (imageFiles.length > 0) {
    const newImages = imageFiles.map((file) => ({
      url: file.cloudinaryUrl,
      publicId: file.cloudinaryPublicId,
      alt: product.name,
      isPrimary: false,
    }));

    if (product.images.length === 0 && newImages.length > 0) {
      newImages[0].isPrimary = true;
    }

    product.images.push(...newImages);
  }

  if (req.files?.modelFiles && req.files.modelFiles.length > 0) {
    const newModelFiles = req.files.modelFiles.map((file) => ({
      url: file.cloudinaryUrl,
      publicId: file.cloudinaryPublicId,
      format: file.format,
      platform: file.platform,
      fileSize: file.fileSize,
      isExternal: false,
    }));

    if (!product.modelFiles) {
      product.modelFiles = [];
    }
    product.modelFiles.push(...newModelFiles);
  }

  // Handle new external model URLs
  if (modelUrls) {
    const parsedUrls = parseJsonField(modelUrls) || [];
    if (parsedUrls.length > 0) {
      const externalModels = parsedUrls.map((model) => ({
        url: model.url,
        format: model.format,
        platform: model.platform || (model.format === 'usdz' ? 'ios' : 'android'),
        isExternal: true,
      }));

      if (!product.modelFiles) {
        product.modelFiles = [];
      }
      product.modelFiles.push(...externalModels);
    }
  }

  await product.save();
  await product.populate("category", "name slug");

  res.status(200).json({
    status: "success",
    data: {
      product,
    },
  });
});

// Delete product - soft delete (Admin only)
exports.deleteProduct = catchAsync(async (req, res, next) => {
  const product = await Product.findOne({ _id: req.params.id, deletedAt: null });

  if (!product) {
    return next(new AppError("Product not found", 404));
  }

  await product.softDelete();

  res.status(200).json({
    status: "success",
    message: "Product deleted successfully",
  });
});

// Hard delete product (Admin only)
exports.hardDeleteProduct = catchAsync(async (req, res, next) => {
  const product = await Product.findById(req.params.id);

  if (!product) {
    return next(new AppError("Product not found", 404));
  }

  if (product.images && product.images.length > 0) {
    const imagePublicIds = product.images.filter((img) => img.publicId).map((img) => img.publicId);
    await deleteFiles(imagePublicIds);
  }

  if (product.modelFiles && product.modelFiles.length > 0) {
    const modelPublicIds = product.modelFiles.filter((m) => m.publicId && !m.isExternal).map((m) => m.publicId);
    await Promise.all(modelPublicIds.map((id) => deleteFile(id, "raw")));
  }

  await Product.findByIdAndDelete(req.params.id);

  res.status(200).json({
    status: "success",
    message: "Product permanently deleted",
  });
});

// Set primary image (Admin only)
exports.setPrimaryImage = catchAsync(async (req, res, next) => {
  const { imageId } = req.body;
  const product = await Product.findOne({ _id: req.params.id, deletedAt: null });

  if (!product) {
    return next(new AppError("Product not found", 404));
  }

  const imageExists = product.images.some((img) => img._id.toString() === imageId);
  if (!imageExists) {
    return next(new AppError("Image not found", 404));
  }

  product.images.forEach((img) => {
    img.isPrimary = img._id.toString() === imageId;
  });

  await product.save();

  res.status(200).json({
    status: "success",
    data: {
      product,
    },
  });
});

// Get related products (Enhanced Multi-Tiered Rule Engine)
exports.getRelatedProducts = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const { limit = 4 } = req.query;
  const limitNum = parseInt(limit, 10);

  const product = await Product.findOne({ _id: id, deletedAt: null });

  if (!product) {
    return next(new AppError("Product not found", 404));
  }

  // Tier 1: Same Category + Same Style
  let query = {
    category: product.category,
    style: product.style,
    _id: { $ne: product._id },
    deletedAt: null,
    status: "active",
  };

  let relatedProducts = await Product.find(query)
    .limit(limitNum)
    .select("name slug price originalPrice images rating category style tags")
    .populate("category", "name slug");

  // Tier 2: Same Category (if Tier 1 didn't fill limit)
  if (relatedProducts.length < limitNum) {
    const existingIds = relatedProducts.map(p => p._id);
    const tier2Query = {
      category: product.category,
      _id: { $ne: product._id, $nin: existingIds },
      deletedAt: null,
      status: "active",
    };

    const tier2Products = await Product.find(tier2Query)
      .limit(limitNum - relatedProducts.length)
      .select("name slug price originalPrice images rating category style tags")
      .populate("category", "name slug");

    relatedProducts = [...relatedProducts, ...tier2Products];
  }

  // Tier 3: Shared Tags (if still below limit)
  if (relatedProducts.length < limitNum && product.tags?.length > 0) {
    const existingIds = relatedProducts.map(p => p._id);
    const tier3Query = {
      tags: { $in: product.tags },
      _id: { $ne: product._id, $nin: existingIds },
      deletedAt: null,
      status: "active",
    };

    const tier3Products = await Product.find(tier3Query)
      .limit(limitNum - relatedProducts.length)
      .select("name slug price originalPrice images rating category style tags")
      .populate("category", "name slug");

    relatedProducts = [...relatedProducts, ...tier3Products];
  }

  res.status(200).json({
    status: "success",
    results: relatedProducts.length,
    data: {
      products: relatedProducts,
    },
  });
});

// Get featured products
exports.getFeaturedProducts = catchAsync(async (req, res, next) => {
  const { limit = 8 } = req.query;

  const products = await Product.find({
    isFeatured: true,
    deletedAt: null,
    status: "active",
  })
    .limit(parseInt(limit, 10))
    .select("name slug price originalPrice images rating category")
    .populate("category", "name slug");

  res.status(200).json({
    status: "success",
    results: products.length,
    data: {
      products,
    },
  });
});

// Get new arrivals
exports.getNewArrivals = catchAsync(async (req, res, next) => {
  const { limit = 8 } = req.query;

  const products = await Product.find({
    isNewArrival: true,
    deletedAt: null,
    status: "active",
  })
    .limit(parseInt(limit, 10))
    .select("name slug price originalPrice images rating category")
    .populate("category", "name slug");

  res.status(200).json({
    status: "success",
    results: products.length,
    data: {
      products,
    },
  });
});

// Update product stock (Admin only)
exports.updateStock = catchAsync(async (req, res, next) => {
  const { stock } = req.body;
  const product = await Product.findOne({ _id: req.params.id, deletedAt: null });

  if (!product) {
    return next(new AppError("Product not found", 404));
  }

  product.stock = parseInt(stock, 10);

  // Auto-update status based on stock
  if (product.stock === 0 && product.status === "active") {
    product.status = "out_of_stock";
  } else if (product.stock > 0 && product.status === "out_of_stock") {
    product.status = "active";
  }

  await product.save();

  res.status(200).json({
    status: "success",
    data: {
      product,
    },
  });
});
