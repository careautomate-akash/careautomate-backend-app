import mongoose from 'mongoose';

const documentSchema = new mongoose.Schema(
  {
    name: { type: String }, // Optional for folders
    folderName: { type: String, required: true },
    uploadedYear: { type: Number, required: true },
    fileKey: { type: String }, // Optional for folders
    fileType: { type: String },
    fileSize: { type: Number },
    s3Location: { type: String },
    isFolderOnly: { type: Boolean, default: false },
    isPublic: { type: Boolean, default: false }, // New field
    description: String,
    category: String,
    tags: [String],
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'causers' },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'causers' },
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' },
    relatedTo: {
      entityType: { type: String, default: 'other' },
      entityId: mongoose.Schema.Types.ObjectId,
    },
  },
  {
    timestamps: true,
  }
);

documentSchema.index({ userId: 1, companyId: 1 });
documentSchema.index({ category: 1 });
documentSchema.index({ tags: 1 });

export default mongoose.model('Document', documentSchema);
