import mongoose from 'mongoose';

const appointmentSchema = new mongoose.Schema(
  {
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

    date: { type: Date, required: true },
    startTime: { type: Date, required: true },
    endTime: { type: Date, required: true },

    activity: { type: String },

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

    placeOfService: { type: String },

    serviceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'services',
      required: true,
    },

    // ✅ New Fields (Clock In / Clock Out)
    clockInTime: {
      type: Date,
      default: null,
    },
    clockOutTime: {
      type: Date,
      default: null,
    },
    clockInAt: {
      type: String,
      default: '',
    },
    clockOutAt: {
      type: String,
      default: '',
    },
    status: {
      type: String,
      enum: ['pending', 'completed', 'cancelled'],
      default: 'pending',
    },

    companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'company' },
  },
  { timestamps: true },
);

export default mongoose.model('appointments', appointmentSchema);
