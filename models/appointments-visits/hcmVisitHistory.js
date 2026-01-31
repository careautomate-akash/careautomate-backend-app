import mongoose from 'mongoose';

const hcmVisitHistorySchema = new mongoose.Schema({
  hcmId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'causers',
  },
  visitId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'visits',
  },
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'causers',
  },
  serviceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'services',
    required: true,
  },
  serviceDate: {
    type: Date,
  },
  serviceUnits: {
    type: Number,
  },
  workedHours: {
    type: Number,
  },
  status: {
    type: String,
    default: 'pending',
  },
});

// Add indexes for faster query performance
// Index for hcmId since it's required in every query
hcmVisitHistorySchema.index({ hcmId: 1 });

// Compound indexes for common query patterns
hcmVisitHistorySchema.index({ hcmId: 1, status: 1 });
hcmVisitHistorySchema.index({ hcmId: 1, tenantId: 1 });
hcmVisitHistorySchema.index({ hcmId: 1, serviceDate: 1 });
hcmVisitHistorySchema.index({ hcmId: 1, status: 1, tenantId: 1 });

const hcmVisitHistory = mongoose.model(
  'hcmVisitHistory',
  hcmVisitHistorySchema
);

export default hcmVisitHistory;
