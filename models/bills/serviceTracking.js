// models/bills/serviceTracking.js

import mongoose from 'mongoose';

const hcmServiceDetailSchema = new mongoose.Schema({
  dateOfService: {
    type: Date,
    required: true,
  },
  workedUnits: {
    type: Number,
    default: 0,
  },
  billAmount: {
    type: Number,
    default: 0,
  },
});
const scheduledServiceDetailSchema = new mongoose.Schema({
  dateOfService: {
    type: Date,
    required: true,
  },
  scheduledUnits: {
    type: Number,
    default: 0,
  },
});
const hcmSchema = new mongoose.Schema({
  hcmId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'causers',
  },
  workedUnits: {
    type: Number,
    default: 0,
  },
  scheduledUnits: {
    type: Number,
    default: 0,
  },
  billAmount: {
    type: Number,
    default: 0,
  },
  serviceDetails: [hcmServiceDetailSchema],
  scheduledDetails: [scheduledServiceDetailSchema],
});

const serviceTrackingSchema = new mongoose.Schema({
  hcms: [
    {
      type: hcmSchema,
      default: [],
    },
  ],
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'causers',
    required: true,
  },
  serviceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'services',
    required: true,
  },
  serviceTypeName: {
    type: String,
  },
  serviceType: {
    type: String,
  },
  startDate: {
    type: Date,
    default: null,
  },
  endDate: {
    type: Date,
    default: null,
  },
  unitsRemaining: {
    type: Number,
    default: 0,
  },
  totalUnits: {
    type: Number,
    default: 0,
  },
  billRate: {
    type: Number,
    default: 0,
  },
  scheduledUnits: {
    type: Number,
    default: 0,
  },
  workedUnits: {
    type: Number,
    default: 0,
  },
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'company',
  },
  saNumber: {
    type: String,
  },
  insurance: {
    type: String,
  },
  coveredParentActivities: {
  type: [String],
  default: [],
}
});

export default mongoose.model('ServiceTracking', serviceTrackingSchema);
