import mongoose from 'mongoose';

const appsDirectlyFromVisitsSchema = new mongoose.Schema({
  visitId: { type: mongoose.Schema.Types.ObjectId, ref: 'Visits' },
  createdAt: { type: Date, default: Date.now },
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Companies' },
  hcmId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'causers',
  },
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'causers',
  },
  date: {
    type: Date,
    required: true,
  },
  startTime: {
    type: Date,
    required: true,
  },
  endTime: {
    type: Date,
    required: true,
  },
  activity: {
    type: String,
  },
  methodOfContact: {
    type: String,
    enum: ['in-person', 'remote', 'indirect'],
  },
  reasonForRemote: {
    type: String,
    required: function () {
      return this.methodOfContact === 'remote';
    },
  },
  placeOfService: {
    type: String,
  },
  serviceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'services',
    required: true,
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'cancelled'],
    default: 'pending',
  },
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'company' },
});

export default mongoose.model(
  'AppsDirectlyFromVisits',
  appsDirectlyFromVisitsSchema
);
