import mongoose from 'mongoose';

// Form submission data schema - flexible to accommodate any form structure
const submissionDataSchema = new mongoose.Schema({}, {
  strict: false, // Allow any field structure
  _id: false
});

// Individual form submission schema
const formSubmissionSchema = new mongoose.Schema({
  formTemplateId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'FormTemplate',
    required: true
  },
  submittedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'causers',
    required: false // Allow anonymous submissions
  },
  assignmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'FormAssignment',
    required: false // Only if submitted through assignment
  },
  data: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    required: true
  },
  // Related Person Information - WHO the form is about
  relatedPersonId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'causers',
    required: false
  },
  relatedPersonName: {
    type: String,
    required: false
  },
  relatedPersonType: {
    type: String,
    enum: ['member', 'employee', 'tenant'],
    required: false
  },
  metadata: {
    ipAddress: String,
    userAgent: String,
    submissionSource: {
      type: String,
      enum: ['web', 'mobile', 'api', 'assignment', 'direct'],
      default: 'web'
    },
    submissionMode: {
      type: String,
      enum: ['remote', 'in-person'],
      default: 'remote'
    },
    assignmentCompleted: {
      type: Boolean,
      default: false
    },
    geolocation: {
      latitude: Number,
      longitude: Number
    },
    sessionId: String,
    hasStaffSignature: Boolean,
    hasMemberSignature: Boolean,
    formType: String,
    relatedTo: String,
    hcmId: String,
    tenantId: String
  },
  status: {
    type: String,
    enum: ['submitted', 'reviewed', 'approved', 'rejected', 'processing'],
    default: 'submitted'
  },
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'causers'
  },
  reviewedAt: Date,
  reviewNotes: String,
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'company'
  },
  attachments: [{
    fieldId: String,
    filename: String,
    originalName: String,
    mimeType: String,
    size: Number,
    url: String,
    s3Key: String
  }],
  // Signature workflow management
  signatureWorkflow: {
    hasSignatures: {
      type: Boolean,
      default: false
    },
    requiredSignatures: [{
      fieldId: String,
      fieldLabel: String,
      signerType: {
        type: String,
        enum: ['member', 'staff', 'employee', 'admin'],
        required: true
      },
      signerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'causers'
      },
      signerName: String,
      signerEmail: String,
      signedAt: Date,
      signatureData: String, // Base64 signature data
      status: {
        type: String,
        enum: ['pending', 'completed', 'skipped'],
        default: 'pending'
      },
      notificationSent: {
        type: Boolean,
        default: false
      },
      notificationSentAt: Date
    }],
    currentStep: {
      type: Number,
      default: 0
    },
    totalSteps: {
      type: Number,
      default: 0
    },
    workflowStatus: {
      type: String,
      enum: ['pending_signatures', 'partially_signed', 'fully_signed', 'completed'],
      default: 'pending_signatures'
    },
    completedAt: Date
  },
  // Form completion status
  submissionType: {
    type: String,
    enum: ['direct_complete', 'member_first', 'staff_first', 'partial_submission'],
    default: 'direct_complete'
  },
  isPartialSubmission: {
    type: Boolean,
    default: false
  },
  awaitingSignatures: {
    type: Boolean,
    default: false
  },
  isDeleted: {
    type: Boolean,
    default: false
  },
  deletedAt: Date,
  deletedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'causers'
  }
}, {
  timestamps: true
});

// Add indexes for better performance
formSubmissionSchema.index({ formTemplateId: 1 });
formSubmissionSchema.index({ submittedBy: 1 });
formSubmissionSchema.index({ relatedPersonId: 1 }); // Index for querying by related person
formSubmissionSchema.index({ assignmentId: 1 });
formSubmissionSchema.index({ companyId: 1 });
formSubmissionSchema.index({ status: 1 });
formSubmissionSchema.index({ createdAt: -1 });
formSubmissionSchema.index({ isDeleted: 1 });

// Instance methods
formSubmissionSchema.methods.toJSON = function () {
  const submission = this.toObject();

  // Convert Map data to plain object for proper JSON serialization
  let submissionData = submission.data;
  if (submissionData && submissionData instanceof Map) {
    submissionData = Object.fromEntries(submissionData);
  } else if (submissionData && typeof submissionData === 'object' && submissionData.constructor === Object) {
    // Handle MongoDB Map that's already converted to object but might need cleanup
    submissionData = JSON.parse(JSON.stringify(submissionData));
  }

  return {
    id: submission._id,
    form_template_id: submission.formTemplateId,
    submitted_by: submission.submittedBy,
    data: submissionData,
    metadata: submission.metadata,
    status: submission.status,
    reviewed_by: submission.reviewedBy,
    reviewed_at: submission.reviewedAt,
    review_notes: submission.reviewNotes,
    attachments: submission.attachments,
    signature_workflow: submission.signatureWorkflow,
    submission_type: submission.submissionType,
    is_partial_submission: submission.isPartialSubmission,
    awaiting_signatures: submission.awaitingSignatures,
    created_at: submission.createdAt,
    updated_at: submission.updatedAt
  };
};

// Signature workflow methods
formSubmissionSchema.methods.initializeSignatureWorkflow = function (formTemplate, submitterInfo) {
  // Filter for all signature-related field types
  const signatureFields = formTemplate.fields.filter(field =>
    field.type === 'signature' ||
    field.type === 'staff signature' ||
    field.type === 'admin signature' ||
    field.type?.toLowerCase().includes('signature')
  );

  if (signatureFields.length === 0) {
    this.signatureWorkflow.hasSignatures = false;
    return;
  }

  this.signatureWorkflow.hasSignatures = true;
  this.signatureWorkflow.totalSteps = signatureFields.length;
  this.signatureWorkflow.requiredSignatures = [];

  signatureFields.forEach(field => {
    // Determine signer type based on field type and label
    let signerType = 'member'; // default
    let signerInfo = submitterInfo;

    // First check the field type
    const fieldType = field.type?.toLowerCase() || '';
    const labelLower = field.label.toLowerCase();

    // Detect signature type from field type or label
    // Staff signatures will be assigned to admin users
    if (fieldType.includes('staff') || labelLower.includes('staff') || labelLower.includes('employee')) {
      signerType = 'staff'; // Will be assigned to admin user
      signerInfo = null; // Will be determined later and assigned to admin
    } else if (fieldType.includes('admin') || labelLower.includes('admin')) {
      signerType = 'admin';
      signerInfo = null; // Will be assigned to admin user
    }

    this.signatureWorkflow.requiredSignatures.push({
      fieldId: field.id,
      fieldLabel: field.label,
      signerType: signerType,
      signerId: signerInfo?.userId || null,
      signerName: signerInfo?.userName || '',
      signerEmail: signerInfo?.userEmail || '',
      status: 'pending'
    });
  });

  // Determine workflow status
  this.updateSignatureWorkflowStatus();
};

formSubmissionSchema.methods.updateSignatureWorkflowStatus = function () {
  const signatures = this.signatureWorkflow.requiredSignatures;
  const completedCount = signatures.filter(sig => sig.status === 'completed').length;
  const totalCount = signatures.length;

  if (completedCount === 0) {
    this.signatureWorkflow.workflowStatus = 'pending_signatures';
    this.awaitingSignatures = true;
  } else if (completedCount < totalCount) {
    this.signatureWorkflow.workflowStatus = 'partially_signed';
    this.awaitingSignatures = true;
  } else {
    this.signatureWorkflow.workflowStatus = 'fully_signed';
    this.signatureWorkflow.completedAt = new Date();
    this.awaitingSignatures = false;

    // Update form status to completed if all signatures are done
    if (this.status === 'submitted') {
      this.status = 'approved';
    }
  }

  this.signatureWorkflow.currentStep = completedCount;
};

formSubmissionSchema.methods.addSignature = function (fieldId, signerInfo, signatureData) {
  const signature = this.signatureWorkflow.requiredSignatures.find(
    sig => sig.fieldId === fieldId
  );

  if (!signature) {
    throw new Error('Signature field not found');
  }

  if (signature.status === 'completed') {
    throw new Error('Signature already completed');
  }

  // Update signature
  signature.signerId = signerInfo.userId;
  signature.signerName = signerInfo.userName;
  signature.signerEmail = signerInfo.userEmail;
  signature.signatureData = signatureData;
  signature.signedAt = new Date();
  signature.status = 'completed';

  // Update form data with signature
  const formData = this.data instanceof Map ? Object.fromEntries(this.data) : this.data;
  formData[fieldId] = signatureData;
  this.data = new Map(Object.entries(formData));

  // Update workflow status
  this.updateSignatureWorkflowStatus();

  return signature;
};

formSubmissionSchema.methods.getNextSignatureNeeded = function () {
  return this.signatureWorkflow.requiredSignatures.find(
    sig => sig.status === 'pending'
  );
};

formSubmissionSchema.methods.getPendingSignatures = function () {
  return this.signatureWorkflow.requiredSignatures.filter(
    sig => sig.status === 'pending'
  );
};

// Static methods
formSubmissionSchema.statics.findByForm = function (formTemplateId, options = {}) {
  const query = {
    formTemplateId,
    isDeleted: false
  };

  if (options.status) {
    query.status = options.status;
  }

  if (options.dateFrom) {
    query.createdAt = { ...query.createdAt, $gte: new Date(options.dateFrom) };
  }

  if (options.dateTo) {
    query.createdAt = { ...query.createdAt, $lte: new Date(options.dateTo) };
  }

  return this.find(query)
    .populate('submittedBy', 'name email')
    .populate('reviewedBy', 'name email')
    .sort({ createdAt: -1 })
    .limit(options.limit || 100)
    .lean(); // Use lean() for better performance when converting Maps
};

formSubmissionSchema.statics.findByUser = function (userId, companyId) {
  // Find forms where:
  // 1. User is the submitter, OR
  // 2. User is a signer and the form is completed (fully signed or approved)
  return this.find({
    $or: [
      // Forms submitted by the user
      { submittedBy: userId },
      // Forms where user has signed and the form is complete
      {
        'signatureWorkflow.requiredSignatures': {
          $elemMatch: {
            signerId: userId,
            status: 'completed'
          }
        },
        'signatureWorkflow.workflowStatus': 'fully_signed'
      }
    ],
    isDeleted: false,
    ...(companyId && { companyId })
  })
    .populate('formTemplateId', 'title description')
    .sort({ createdAt: -1 })
    .lean(); // Use lean() for better performance when converting Maps
};

// Find forms pending signatures for a specific user
formSubmissionSchema.statics.findPendingSignatures = function (userId, userType, companyId) {
  // Validate companyId is provided
  if (!companyId) {
    console.warn('findPendingSignatures called without companyId - returning empty results');
    return this.find({ _id: null }); // Return empty query
  }

  // Build the query based on user type
  // For admin users, they should see both 'admin' and 'staff' type signatures
  // since all staff signatures are assigned to admins (within their company only)
  let signatureQuery;

  if (userType === 'admin') {
    signatureQuery = {
      $elemMatch: {
        $or: [
          { signerId: userId, status: 'pending' },
          { signerType: 'admin', signerId: null, status: 'pending' },
          { signerType: 'staff', signerId: null, status: 'pending' } // Staff signatures go to admin
        ]
      }
    };
  } else {
    signatureQuery = {
      $elemMatch: {
        $or: [
          { signerId: userId, status: 'pending' },
          { signerType: userType, signerId: null, status: 'pending' }
        ]
      }
    };
  }

  return this.find({
    isDeleted: false,
    awaitingSignatures: true,
    companyId: companyId, // Always filter by company - CRITICAL for multi-tenant security
    'signatureWorkflow.requiredSignatures': signatureQuery
  })
    .populate('formTemplateId', 'title description')
    .populate('submittedBy', 'name email')
    .sort({ createdAt: -1 });
};

// Find all forms awaiting any signatures
formSubmissionSchema.statics.findAwaitingSignatures = function (companyId) {
  return this.find({
    isDeleted: false,
    awaitingSignatures: true,
    'signatureWorkflow.workflowStatus': { $in: ['pending_signatures', 'partially_signed'] },
    ...(companyId && { companyId })
  })
    .populate('formTemplateId', 'title description')
    .populate('submittedBy', 'name email')
    .sort({ createdAt: -1 });
};

// Virtual for form template details
formSubmissionSchema.virtual('formTemplate', {
  ref: 'FormTemplate',
  localField: 'formTemplateId',
  foreignField: '_id',
  justOne: true
});

// Ensure virtual fields are serialized
formSubmissionSchema.set('toJSON', { virtuals: true });
formSubmissionSchema.set('toObject', { virtuals: true });

export default mongoose.model('FormSubmission', formSubmissionSchema);