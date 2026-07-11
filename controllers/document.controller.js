const Document = require("../models/document.model");
const { queueDocumentIngestion } = require("../services/notificationQueue");
const { deleteFile } = require("../middleware/upload.middleware");
const { QdrantClient } = require("@qdrant/js-client-rest");
const AppError = require("../utils/AppError");

// Initialize Qdrant client to delete vectors when document is deleted
const qdrantUrl = process.env.QDRANT_URL || "http://localhost:6333";
const qdrantApiKey = process.env.QDRANT_API_KEY;
const qdrant = new QdrantClient({ url: qdrantUrl, apiKey: qdrantApiKey });
const COLLECTION_NAME = "knowledge_base";

exports.uploadDocument = async (req, res, next) => {
  try {
    if (!req.processedDocument) {
      return next(new AppError("Document file upload failed", 400));
    }

    const { fileName, fileUrl, cloudinaryPublicId, fileType } = req.processedDocument;

    const doc = await Document.create({
      fileName,
      fileType,
      fileUrl,
      filePublicId: cloudinaryPublicId,
      status: "pending",
      uploadedBy: req.user.id,
    });

    // Enqueue background processing job
    await queueDocumentIngestion(doc._id.toString());

    res.status(201).json({
      status: "success",
      message: "Document uploaded and scheduled for indexing",
      data: { document: doc },
    });
  } catch (error) {
    next(error);
  }
};

exports.listDocuments = async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;

    const [documents, total] = await Promise.all([
      Document.find()
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .populate("uploadedBy", "firstName lastName email")
        .lean(),
      Document.countDocuments(),
    ]);

    res.status(200).json({
      status: "success",
      results: documents.length,
      data: {
        documents,
        pagination: {
          total,
          page: Number(page),
          limit: Number(limit),
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

exports.deleteDocument = async (req, res, next) => {
  try {
    const doc = await Document.findById(req.params.id);
    if (!doc) {
      return next(new AppError("Document not found", 404));
    }

    // 1. Delete vectors from Qdrant
    try {
      await qdrant.delete(COLLECTION_NAME, {
        filter: {
          must: [
            {
              key: "documentId",
              match: {
                value: doc._id.toString(),
              },
            },
          ],
        },
      });
      console.log(`✓ Deleted vectors for document ${doc._id} from Qdrant`);
    } catch (qdrantError) {
      console.error(`Failed to delete vectors from Qdrant: ${qdrantError.message}`);
    }

    // 2. Delete file from Cloudinary
    if (doc.filePublicId) {
      try {
        await deleteFile(doc.filePublicId, "raw");
        console.log(`✓ Deleted file from Cloudinary: ${doc.filePublicId}`);
      } catch (cloudinaryError) {
        console.error(`Failed to delete file from Cloudinary: ${cloudinaryError.message}`);
      }
    }

    // 3. Delete Document record from MongoDB
    await Document.findByIdAndDelete(doc._id);

    res.status(200).json({
      status: "success",
      message: "Document deleted successfully from both database and vector store",
    });
  } catch (error) {
    next(error);
  }
};

exports.retryDocumentIngestion = async (req, res, next) => {
  try {
    const doc = await Document.findById(req.params.id);
    if (!doc) {
      return next(new AppError("Document not found", 404));
    }

    doc.status = "pending";
    doc.error = null;
    await doc.save();

    // Re-enqueue background processing job
    await queueDocumentIngestion(doc._id.toString());

    res.status(200).json({
      status: "success",
      message: "Re-indexing scheduled successfully",
      data: { document: doc },
    });
  } catch (error) {
    next(error);
  }
};
