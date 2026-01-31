import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
  },
  password: {
    type: String,
    required: true,
  },
  info_id: {
    type: String,
  },
  phoneNo: {
    type: String,
  },
  state: {
    type: String,
  },
  city: {
    type: String,
  },
  accountSetup: {
    type: Boolean,
    default: false,
  },
  role: {
    type: Number,
    default: 0,
  },
  passwordChangedAt: {
    type: Date,
    default: null,
  },
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'company',
  },
  companyName: {
    type: String,
  },
  // Profile image fields
  profileImageKey: {
    type: String,
    default: null,
  },
  profileImageUrl: {
    type: String,
    default: null,
  },
  dateCreated: {
    type: Date,
    default: Date.now(),
  },
  movedOut: {
    type: Boolean,
    default: false,
  },
  movedOutDate: {
    type: Date,
    default: null,
  },
  movedOutReason: {
    type: String,
  },
  fcmToken: {
    type: String,
    default: null,
  },
  timezone: {
    type: String,
    default: 'UTC',
  },
  // Subscription management fields
  subscription_status: {
    type: String,
    enum: ['trial', 'subscribed', 'cancelled', 'expired'],
    default: 'trial',
  },
  trial_start_date: {
    type: Date,
    default: Date.now,
  },
  trial_end_date: {
    type: Date,
    default: function () {
      const trialDays = 13; // 13 days added to start date = 14 days total (inclusive)
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + trialDays);
      return endDate;
    },
  },
  subscription_start_date: {
    type: Date,
    default: null,
  },
  subscription_end_date: {
    type: Date,
    default: null,
  },
  is_active: {
    type: Boolean,
    default: true,
  },
  deactivation_date: {
    type: Date,
    default: null,
  },
  deactivation_reason: {
    type: String,
    default: null,
  },
});

// Middleware to handle conditional fields
userSchema.pre('save', function (next) {
  if (this.role !== 0) {
    // Remove fields if role is not 1
    this.movedOut = undefined;
    this.movedOutDate = undefined;
    this.movedOutReason = undefined;
  }
  next();
});

export default mongoose.model('causers', userSchema);
