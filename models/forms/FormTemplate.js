import mongoose from 'mongoose';

// Field configuration schema for different field types
const fieldConfigSchema = new mongoose.Schema({
  // For file fields
  acceptedTypes: [String],
  maxSize: Number,
  multiple: Boolean,
  
  // For signature fields
  width: Number,
  height: Number,
  backgroundColor: String,
  penColor: String,
}, { _id: false });

// Individual form field schema
const formFieldSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true
  },
  type: {
    type: String,
    required: true,
    enum: ['text', 'email', 'password', 'number', 'textarea', 'select', 'radio', 'date', 'checkbox', 'file', 'signature', 'staff signature', 'member signature', 'employee signature']
  },
  label: {
    type: String,
    required: true
  },
  placeholder: {
    type: String,
    default: ''
  },
  required: {
    type: Boolean,
    default: false
  },
  options: [String], // For select and radio fields
  fileConfig: fieldConfigSchema, // For file upload fields
  signatureConfig: fieldConfigSchema, // For signature fields
  description: String // Optional field description
}, { _id: false });

// Main form template schema
const formTemplateSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    enum: ['member', 'employee', 'custom'],
    default: 'custom'
  },
  fields: {
    type: [formFieldSchema],
    validate: {
      validator: function(fields) {
        return fields && fields.length > 0;
      },
      message: 'Form must have at least one field'
    }
  },
  status: {
    type: String,
    enum: ['draft', 'published', 'archived'],
    default: 'draft'
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'causers',
    required: true
  },
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'company'
  },
  isActive: {
    type: Boolean,
    default: true
  },
  version: {
    type: Number,
    default: 1
  },
  tags: [String],
  settings: {
    allowMultipleSubmissions: {
      type: Boolean,
      default: true
    },
    requireAuthentication: {
      type: Boolean,
      default: false
    },
    notificationEmails: [String],
    successMessage: {
      type: String,
      default: 'Thank you for your submission!'
    },
    redirectUrl: String
  }
}, {
  timestamps: true
});

// Add indexes for better performance
formTemplateSchema.index({ createdBy: 1 });
formTemplateSchema.index({ companyId: 1 });
formTemplateSchema.index({ status: 1 });
formTemplateSchema.index({ isActive: 1 });
formTemplateSchema.index({ title: 'text', description: 'text' });

// Instance methods
formTemplateSchema.methods.toJSON = function() {
  const form = this.toObject();
  return {
    id: form._id,
    title: form.title,
    description: form.description,
    fields: form.fields,
    status: form.status,
    isActive: form.isActive,
    version: form.version,
    tags: form.tags,
    settings: form.settings,
    created_at: form.createdAt,
    updated_at: form.updatedAt,
    createdBy: form.createdBy
  };
};

// Static methods
formTemplateSchema.statics.findByUser = function(userId, companyId) {
  return this.find({ 
    createdBy: userId, 
    isActive: true,
    ...(companyId && { companyId })
  }).sort({ createdAt: -1 });
};

formTemplateSchema.statics.findPublished = function(companyId) {
  return this.find({ 
    status: 'published', 
    isActive: true,
    ...(companyId && { companyId })
  }).sort({ createdAt: -1 });
};

export default mongoose.model('FormTemplate', formTemplateSchema);