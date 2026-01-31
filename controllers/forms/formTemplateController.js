import FormTemplate from '../../models/forms/FormTemplate.js';
import FormSubmission from '../../models/forms/FormSubmission.js';
import createHttpError from 'http-errors';
import mongoose from 'mongoose';

// Get all forms for the authenticated user
export const getFormTemplates = async (req, res) => {
  try {
    const { page = 1, limit = 10, search, status, description } = req.query;
    const userId = req.user._id;
    const companyId = req.user.companyId;

    // Build query
    let query = {
      createdBy: userId,
      isActive: true
    };

    if (companyId) {
      query.companyId = companyId;
    }

    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    if (status) {
      query.status = status;
    }

    if (description && description !== 'all') {
      query.description = description;
    }

    // Execute query with pagination
    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      sort: { createdAt: -1 }
    };

    const forms = await FormTemplate.find(query)
      .sort(options.sort)
      .limit(options.limit * 1)
      .skip((options.page - 1) * options.limit);

    const total = await FormTemplate.countDocuments(query);

    res.status(200).json({
      success: true,
      data: forms,
      pagination: {
        currentPage: options.page,
        totalPages: Math.ceil(total / options.limit),
        totalItems: total,
        itemsPerPage: options.limit
      }
    });
  } catch (error) {
    console.error('Error fetching form templates:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch form templates',
      error: error.message
    });
  }
};

// Get a specific form template by ID
export const getFormTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid form ID'
      });
    }

    // Get user's companyId from database since JWT might not include it
    const User = (await import('../../models/account/users.js')).default;
    const currentUser = await User.findById(userId).select('companyId role');
    
    // Build query - allow viewing if:
    // 1. User created the form, OR
    // 2. Form belongs to the same company (for members to view forms assigned to them), OR
    // 3. Form has no companyId (legacy forms)
    const query = {
      _id: id,
      isActive: true
    };

    // If user has a companyId, allow viewing company forms
    if (currentUser?.companyId) {
      query.$or = [
        { createdBy: userId },
        { companyId: currentUser.companyId },
        { companyId: { $exists: false } } // Legacy forms without companyId
      ];
    } else {
      // If no companyId, only allow viewing own forms or forms without companyId
      query.$or = [
        { createdBy: userId },
        { companyId: { $exists: false } }
      ];
    }

    const form = await FormTemplate.findOne(query);

    if (!form) {
      return res.status(404).json({
        success: false,
        message: 'Form not found'
      });
    }

    res.status(200).json({
      success: true,
      data: form
    });
  } catch (error) {
    console.error('Error fetching form template:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch form template',
      error: error.message
    });
  }
};

// Create a new form template
export const createFormTemplate = async (req, res) => {
  try {
    const { title, description, fields, settings, tags } = req.body;
    const userId = req.user._id;
    const companyId = req.user.companyId;

    // Validate required fields
    if (!title || !fields || !Array.isArray(fields) || fields.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Title and at least one field are required'
      });
    }

    // Validate field structure
    for (const field of fields) {
      if (!field.id || !field.type || !field.label) {
        return res.status(400).json({
          success: false,
          message: 'Each field must have id, type, and label'
        });
      }
    }

    const formTemplate = new FormTemplate({
      title: title.trim(),
      description: description || 'custom',
      fields,
      createdBy: userId,
      companyId,
      settings: settings || {},
      tags: tags || []
    });

    const savedForm = await formTemplate.save();

    res.status(201).json({
      success: true,
      message: 'Form template created successfully',
      data: savedForm
    });
  } catch (error) {
    console.error('Error creating form template:', error);
    
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        error: Object.values(error.errors).map(err => err.message)
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to create form template',
      error: error.message
    });
  }
};

// Update an existing form template
export const updateFormTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, fields, settings, tags, status } = req.body;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid form ID'
      });
    }

    // Validate fields if provided
    if (fields) {
      if (!Array.isArray(fields) || fields.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Fields must be a non-empty array'
        });
      }

      for (const field of fields) {
        if (!field.id || !field.type || !field.label) {
          return res.status(400).json({
            success: false,
            message: 'Each field must have id, type, and label'
          });
        }
      }
    }

    const updateData = {};
    if (title) updateData.title = title.trim();
    if (description) updateData.description = description;
    if (fields) updateData.fields = fields;
    if (settings) updateData.settings = settings;
    if (tags) updateData.tags = tags;
    if (status) updateData.status = status;

    const updatedForm = await FormTemplate.findOneAndUpdate(
      {
        _id: id,
        createdBy: userId,
        isActive: true
      },
      updateData,
      {
        new: true,
        runValidators: true
      }
    );

    if (!updatedForm) {
      return res.status(404).json({
        success: false,
        message: 'Form not found or you do not have permission to update it'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Form template updated successfully',
      data: updatedForm
    });
  } catch (error) {
    console.error('Error updating form template:', error);
    
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        error: Object.values(error.errors).map(err => err.message)
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to update form template',
      error: error.message
    });
  }
};

// Delete a form template (soft delete)
export const deleteFormTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid form ID'
      });
    }

    const deletedForm = await FormTemplate.findOneAndUpdate(
      {
        _id: id,
        createdBy: userId,
        isActive: true
      },
      {
        isActive: false,
        deletedAt: new Date()
      },
      { new: true }
    );

    if (!deletedForm) {
      return res.status(404).json({
        success: false,
        message: 'Form not found or you do not have permission to delete it'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Form template deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting form template:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete form template',
      error: error.message
    });
  }
};

// Duplicate a form template
export const duplicateFormTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;
    const companyId = req.user.companyId;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid form ID'
      });
    }

    const originalForm = await FormTemplate.findOne({
      _id: id,
      createdBy: userId,
      isActive: true
    });

    if (!originalForm) {
      return res.status(404).json({
        success: false,
        message: 'Form not found or you do not have permission to duplicate it'
      });
    }

    // Create duplicate with modified title
    const duplicateForm = new FormTemplate({
      title: `${originalForm.title} (Copy)`,
      description: originalForm.description,
      fields: originalForm.fields,
      createdBy: userId,
      companyId,
      settings: originalForm.settings,
      tags: originalForm.tags,
      status: 'draft' // Always create duplicates as draft
    });

    const savedDuplicate = await duplicateForm.save();

    res.status(201).json({
      success: true,
      message: 'Form template duplicated successfully',
      data: savedDuplicate
    });
  } catch (error) {
    console.error('Error duplicating form template:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to duplicate form template',
      error: error.message
    });
  }
};

// Get form statistics
export const getFormStatistics = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid form ID'
      });
    }

    // Verify form ownership
    const form = await FormTemplate.findOne({
      _id: id,
      createdBy: userId,
      isActive: true
    });

    if (!form) {
      return res.status(404).json({
        success: false,
        message: 'Form not found'
      });
    }

    // Get submission statistics
    const totalSubmissions = await FormSubmission.countDocuments({
      formTemplateId: id,
      isDeleted: false
    });

    const submissionsThisMonth = await FormSubmission.countDocuments({
      formTemplateId: id,
      isDeleted: false,
      createdAt: {
        $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      }
    });

    const submissionsToday = await FormSubmission.countDocuments({
      formTemplateId: id,
      isDeleted: false,
      createdAt: {
        $gte: new Date(new Date().setHours(0, 0, 0, 0))
      }
    });

    const statusBreakdown = await FormSubmission.aggregate([
      {
        $match: {
          formTemplateId: new mongoose.Types.ObjectId(id),
          isDeleted: false
        }
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    res.status(200).json({
      success: true,
      data: {
        formId: id,
        formTitle: form.title,
        totalSubmissions,
        submissionsThisMonth,
        submissionsToday,
        statusBreakdown: statusBreakdown.reduce((acc, item) => {
          acc[item._id] = item.count;
          return acc;
        }, {}),
        createdAt: form.createdAt,
        lastUpdated: form.updatedAt
      }
    });
  } catch (error) {
    console.error('Error fetching form statistics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch form statistics',
      error: error.message
    });
  }
};