import mongoose from 'mongoose';

// Schema for tracking form assignments to tenants/employees
const formAssignmentSchema = new mongoose.Schema({
  formTemplateId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'FormTemplate',
    required: true
  },
  assignedTo: {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true
    },
    userType: {
      type: String,
      enum: ['tenant', 'employee'],
      required: true
    },
    userName: {
      type: String,
      required: true
    },
    userEmail: {
      type: String
    }
  },
  assignedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'causers',
    required: true
  },
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'company'
  },
  status: {
    type: String,
    enum: ['pending', 'in-progress', 'completed', 'expired'],
    default: 'pending'
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  dueDate: {
    type: Date
  },
  assignmentNote: {
    type: String
  },
  reminderSettings: {
    enabled: {
      type: Boolean,
      default: false
    },
    reminderDays: [{
      type: Number // Days before due date to send reminder
    }]
  },
  submissionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'FormSubmission'
  },
  startedAt: {
    type: Date
  },
  completedAt: {
    type: Date
  },
  viewedAt: {
    type: Date
  },
  isActive: {
    type: Boolean,
    default: true
  },
  notifications: [{
    type: {
      type: String,
      enum: ['assigned', 'reminder', 'overdue', 'completed']
    },
    sentAt: {
      type: Date,
      default: Date.now
    },
    status: {
      type: String,
      enum: ['sent', 'failed', 'pending'],
      default: 'sent'
    }
  }]
}, {
  timestamps: true
});

// Add indexes for better performance
formAssignmentSchema.index({ 'assignedTo.userId': 1 });
formAssignmentSchema.index({ 'assignedTo.userType': 1 });
formAssignmentSchema.index({ assignedBy: 1 });
formAssignmentSchema.index({ formTemplateId: 1 });
formAssignmentSchema.index({ companyId: 1 });
formAssignmentSchema.index({ status: 1 });
formAssignmentSchema.index({ dueDate: 1 });
formAssignmentSchema.index({ isActive: 1 });

// Compound indexes
formAssignmentSchema.index({ 
  'assignedTo.userId': 1, 
  'assignedTo.userType': 1, 
  status: 1 
});

// Virtual for checking if assignment is overdue
formAssignmentSchema.virtual('isOverdue').get(function() {
  return this.dueDate && new Date() > this.dueDate && this.status !== 'completed';
});

// Instance methods
formAssignmentSchema.methods.markAsViewed = function() {
  if (!this.viewedAt) {
    this.viewedAt = new Date();
  }
  if (this.status === 'pending') {
    this.status = 'in-progress';
    this.startedAt = new Date();
  }
  return this.save();
};

formAssignmentSchema.methods.markAsCompleted = function(submissionId) {
  this.status = 'completed';
  this.completedAt = new Date();
  if (submissionId) {
    this.submissionId = submissionId;
  }
  return this.save();
};

// Static methods
formAssignmentSchema.statics.findByUser = function(userId, userType, status = null) {
  const query = {
    'assignedTo.userId': userId,
    'assignedTo.userType': userType,
    isActive: true
  };
  
  if (status) {
    query.status = status;
  }
  
  return this.find(query)
    .populate('formTemplateId', 'title description fields settings')
    .populate('assignedBy', 'name email')
    .sort({ createdAt: -1 });
};

formAssignmentSchema.statics.findOverdue = function() {
  return this.find({
    dueDate: { $lt: new Date() },
    status: { $in: ['pending', 'in-progress'] },
    isActive: true
  }).populate('formTemplateId assignedBy');
};

formAssignmentSchema.statics.getAssignmentStats = function(companyId, userType = null) {
  const matchQuery = {
    companyId,
    isActive: true
  };
  
  if (userType) {
    matchQuery['assignedTo.userType'] = userType;
  }
  
  return this.aggregate([
    { $match: matchQuery },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 }
      }
    }
  ]);
};

// Pre-save middleware
formAssignmentSchema.pre('save', function(next) {
  // Auto-expire assignments that are past due
  if (this.dueDate && new Date() > this.dueDate && this.status === 'pending') {
    this.status = 'expired';
  }
  next();
});

export default mongoose.model('FormAssignment', formAssignmentSchema);