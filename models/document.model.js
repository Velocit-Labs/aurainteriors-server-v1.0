const mongoose = require("mongoose");

const documentSchema = new mongoose.Schema(
  {
    fileName: {
      type: String,
      required: [true, "Document must have a file name"],
      trim: true,
    },
    fileType: {
      type: String,
      enum: ["pdf", "docx", "txt", "csv"],
      required: [true, "Document must have a file type"],
    },
    fileUrl: {
      type: String,
      required: [true, "Document must have a file URL"],
    },
    filePublicId: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      enum: ["pending", "processing", "indexed", "failed"],
      default: "pending",
      index: true,
    },
    version: {
      type: Number,
      default: 1,
    },
    error: {
      type: String,
      default: null,
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

documentSchema.index({ status: 1, createdAt: -1 });

const Document = mongoose.model("Document", documentSchema);

module.exports = Document;
