import mongoose from 'mongoose';

const ScheduledNotificationSchema = new mongoose.Schema(
  {
    targetUserId: {
      type: mongoose.Types.ObjectId,
      ref: 'users',
      required: true,
    },
    title: {
      type: String,
      required: true,
    },
    message: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      required: true, // e.g., 'visit', 'billing', 'custom'
    },
    scheduledAt: {
      type: Date,
      required: true, // UTC
    },
    sentAt: {
      type: Date,
    },
    status: {
      type: String,
      enum: ['pending', 'sent', 'failed'],
      default: 'pending',
    },
    refId: {
      type: mongoose.Types.ObjectId, // Optional reference (e.g., visitId)
    },
  },
  { timestamps: true }
);

export default mongoose.model(
  'ScheduledNotification',
  ScheduledNotificationSchema
);
