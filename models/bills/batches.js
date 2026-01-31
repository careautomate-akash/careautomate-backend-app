import mongoose from 'mongoose';

const batchesSchema = new mongoose.Schema(
  {
    batchName: {
      type: String,
      required: true,
    },
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'company',
      required: true,
      index: true,
    },
    ediFiles: {
      type: [Object],
      default: [],
    },
    batchStatus: {
      type: String,
      default: 'billed',
    },
    batchDate: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

const Batches = mongoose.model('Batches', batchesSchema);

export default Batches;
