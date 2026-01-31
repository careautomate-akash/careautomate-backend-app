import FormAssignment from '../../models/forms/FormAssignment.js';
import FormTemplate from '../../models/forms/FormTemplate.js';
import FormSubmission from '../../models/forms/FormSubmission.js';
import User from '../../models/account/users.js';
import Tenant from '../../models/hcm-tenants/tenant.js';
import { sendAssignmentNotification } from '../../services/formNotificationService.js';
import mongoose from 'mongoose';

// Admin assigns form to tenant or employee
export const assignFormToUser = async (req, res) => {
  try {
    const { 
      formTemplateId, 
      assignToType, 
      assignToIds, 
      dueDate, 
      priority = 'medium',
      assignmentNote,
      reminderSettings 
    } = req.body;
    const assignedBy = req.user._id;
    
    // Get user's companyId from database since JWT doesn't include it
    const currentUser = await User.findById(assignedBy).select('companyId');
    if (!currentUser || !currentUser.companyId) {
      return res.status(400).json({
        success: false,
        message: 'User company information not found'
      });
    }
    const companyId = currentUser.companyId;



    // Validate required fields
    if (!formTemplateId || !assignToType || !assignToIds || !Array.isArray(assignToIds)) {
      return res.status(400).json({
        success: false,
        message: 'Form ID, assignment type, and user IDs are required'
      });
    }

    // Validate assignment type
    if (!['tenant', 'employee'].includes(assignToType)) {
      return res.status(400).json({
        success: false,
        message: 'Assignment type must be either "tenant" or "employee"'
      });
    }

    // Verify form template exists and user has access
    const formTemplate = await FormTemplate.findOne({
      _id: formTemplateId,
      createdBy: assignedBy,
      isActive: true
    });

    if (!formTemplate) {
      return res.status(404).json({
        success: false,
        message: 'Form template not found or access denied'
      });
    }

    const assignments = [];
    const errors = [];

    // Process each assignment
    for (const userId of assignToIds) {
      try {
        let user = null;
        let tenant = null;
        let userName = '';
        let userEmail = '';

        // Find user based on type
        if (assignToType === 'employee') {
          user = await User.findOne({
            _id: userId,
            companyId,
            role: { $ne: 0 } // Not tenant role
          });
          if (user) {
            userName = user.name;
            userEmail = user.email;
          }
        } else if (assignToType === 'tenant') {
          // For tenants, we need to check both the tenant collection and users collection
          tenant = await Tenant.findOne({
            _id: userId,
            companyId
          });
          
          if (tenant) {
            userName = `${tenant.personalInfo.firstName} ${tenant.personalInfo.lastName}`;
            userEmail = tenant.personalInfo.contact?.email;
          } else {
            // Check if it's a tenant user in the users collection
            user = await User.findOne({
              _id: userId,
              companyId,
              role: 0 // Tenant role
            });
            if (user) {
              userName = user.name;
              userEmail = user.email;
            }
          }
        }

        if (!user && !tenant && assignToType === 'tenant') {
          errors.push(`Tenant ${userId} not found in company ${companyId}`);
          continue;
        }

        if (!user && assignToType === 'employee') {
          errors.push(`Employee ${userId} not found`);
          continue;
        }

        // Check if assignment already exists
        const existingAssignment = await FormAssignment.findOne({
          formTemplateId,
          'assignedTo.userId': userId,
          'assignedTo.userType': assignToType,
          isActive: true,
          status: { $in: ['pending', 'in-progress'] }
        });

        if (existingAssignment) {
          errors.push(`Form already assigned to ${userName}`);
          continue;
        }

        // Create form assignment
        const assignment = new FormAssignment({
          formTemplateId,
          assignedTo: {
            userId,
            userType: assignToType,
            userName,
            userEmail
          },
          assignedBy,
          companyId,
          dueDate: dueDate ? new Date(dueDate) : null,
          priority,
          assignmentNote,
          reminderSettings: reminderSettings || { enabled: false, reminderDays: [] }
        });

        const savedAssignment = await assignment.save();
        await savedAssignment.populate([
          { path: 'formTemplateId', select: 'title description' },
          { path: 'assignedBy', select: 'name email' }
        ]);

        assignments.push(savedAssignment);

        // Send notification email (async - don't wait for it)
        if (userEmail) {
          sendAssignmentNotification(savedAssignment).catch(err => {
            console.error('Failed to send assignment notification:', err);
          });
        }

      } catch (error) {
        console.error(`Error assigning form to user ${userId}:`, error);
        errors.push(`Failed to assign form to user ${userId}: ${error.message}`);
      }
    }

    // Prepare response
    const response = {
      success: assignments.length > 0,
      message: assignments.length > 0 
        ? `Successfully assigned form to ${assignments.length} user(s)`
        : 'Failed to assign form to any users',
      data: {
        assignments,
        totalAssigned: assignments.length,
        errors: errors.length > 0 ? errors : undefined
      }
    };

    res.status(assignments.length > 0 ? 201 : 400).json(response);

  } catch (error) {
    console.error('Error assigning form:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to assign form',
      error: error.message
    });
  }
};

// Get forms assigned to current user (tenant/employee)
export const getMyAssignedForms = async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    const userId = req.user._id;
    const userRole = req.user.role;
    
    // Determine user type based on role
    const userType = userRole === 0 ? 'tenant' : 'employee';

    // Build query
    let query = {
      'assignedTo.userId': userId,
      'assignedTo.userType': userType,
      isActive: true
    };

    if (status && status !== 'all') {
      query.status = status;
    }

    // Execute query with pagination
    const options = {
      page: parseInt(page),
      limit: parseInt(limit)
    };

    const assignments = await FormAssignment.find(query)
      .populate('formTemplateId', 'title description fields settings')
      .populate('assignedBy', 'name email')
      .sort({ createdAt: -1 })
      .limit(options.limit)
      .skip((options.page - 1) * options.limit);

    const total = await FormAssignment.countDocuments(query);

    // Add computed properties
    const assignmentsWithStatus = assignments.map(assignment => {
      const assignmentObj = assignment.toObject();
      assignmentObj.isOverdue = assignment.isOverdue;
      return assignmentObj;
    });

    res.status(200).json({
      success: true,
      data: assignmentsWithStatus,
      pagination: {
        currentPage: options.page,
        totalPages: Math.ceil(total / options.limit),
        totalItems: total,
        itemsPerPage: options.limit
      }
    });

  } catch (error) {
    console.error('Error fetching assigned forms:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch assigned forms',
      error: error.message
    });
  }
};

// Get specific assigned form details
export const getAssignedFormDetails = async (req, res) => {
  try {
    const { assignmentId } = req.params;
    const userId = req.user._id;
    const userRole = req.user.role;
    
    if (!mongoose.Types.ObjectId.isValid(assignmentId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid assignment ID'
      });
    }

    const userType = userRole === 0 ? 'tenant' : 'employee';

    const assignment = await FormAssignment.findOne({
      _id: assignmentId,
      'assignedTo.userId': userId,
      'assignedTo.userType': userType,
      isActive: true
    })
    .populate('formTemplateId')
    .populate('assignedBy', 'name email')
    .populate('submissionId');

    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: 'Assigned form not found'
      });
    }

    // Mark as viewed if not already viewed
    if (!assignment.viewedAt) {
      await assignment.markAsViewed();
    }

    const assignmentObj = assignment.toObject();
    assignmentObj.isOverdue = assignment.isOverdue;

    res.status(200).json({
      success: true,
      data: assignmentObj
    });

  } catch (error) {
    console.error('Error fetching assigned form details:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch assigned form details',
      error: error.message
    });
  }
};

// Get all form assignments (Admin view)
export const getAllFormAssignments = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      status, 
      userType, 
      formId, 
      search,
      userId // Added to filter by specific user ID
    } = req.query;
    
    // Get user's companyId from database since JWT doesn't include it
    const currentUser = await User.findById(req.user._id).select('companyId');
    if (!currentUser || !currentUser.companyId) {
      return res.status(400).json({
        success: false,
        message: 'User company information not found'
      });
    }
    const companyId = currentUser.companyId;

    // Build query
    let query = {
      companyId,
      isActive: true
    };

    if (status && status !== 'all') {
      query.status = status;
    }

    if (userType && userType !== 'all') {
      query['assignedTo.userType'] = userType;
    }

    if (formId) {
      query.formTemplateId = formId;
    }

    if (userId) {
      query['assignedTo.userId'] = userId;
    }

    if (search) {
      query.$or = [
        { 'assignedTo.userName': { $regex: search, $options: 'i' } },
        { 'assignedTo.userEmail': { $regex: search, $options: 'i' } },
        { assignmentNote: { $regex: search, $options: 'i' } }
      ];
    }

    // Execute query with pagination
    const options = {
      page: parseInt(page),
      limit: parseInt(limit)
    };

    const assignments = await FormAssignment.find(query)
      .populate('formTemplateId', 'title description')
      .populate('assignedBy', 'name email')
      .populate('submissionId', 'status createdAt')
      .sort({ createdAt: -1 })
      .limit(options.limit)
      .skip((options.page - 1) * options.limit);

    const total = await FormAssignment.countDocuments(query);

    // Add computed properties
    const assignmentsWithStatus = assignments.map(assignment => {
      const assignmentObj = assignment.toObject();
      assignmentObj.isOverdue = assignment.isOverdue;
      return assignmentObj;
    });

    // Also fetch direct submissions for this user (forms submitted about them, not assigned)
    let directSubmissions = [];
    let directSubmissionsCount = 0;
    if (userId && userType) {
      // Convert userId to ObjectId for proper MongoDB query
      const userObjectId = mongoose.Types.ObjectId.isValid(userId) 
        ? new mongoose.Types.ObjectId(userId) 
        : userId;
      
      const submissionQuery = {
        relatedPersonId: userObjectId,  // Use ObjectId instead of string
        relatedPersonType: userType,  // Use userType directly without conversion
        assignmentId: { $exists: false }, // Only non-assignment submissions
        isDeleted: false,
        companyId
      };
      
      console.log('🔍 Query parameters received - userId:', userId, 'userType:', userType);
      console.log('🔍 Direct submission query:', JSON.stringify(submissionQuery, null, 2));
      
      // DEBUG: Check what's in the database for this user
      const debugQuery = {
        relatedPersonId: userObjectId,
        assignmentId: { $exists: false },
        isDeleted: false,
        companyId
      };
      const allUserSubmissions = await FormSubmission.find(debugQuery)
        .select('relatedPersonId relatedPersonName relatedPersonType status createdAt')
        .limit(5);
      console.log('🔍 DEBUG - ALL submissions for this userId (any type):', JSON.stringify(allUserSubmissions, null, 2));
      
      // DEBUG: Check ANY recent direct submissions in this company
      const recentDirectSubmissions = await FormSubmission.find({
        assignmentId: { $exists: false },
        isDeleted: false,
        companyId,
        relatedPersonId: { $exists: true }
      })
      .select('relatedPersonId relatedPersonName relatedPersonType status createdAt')
      .sort({ createdAt: -1 })
      .limit(3);
      console.log('🔍 DEBUG - Recent direct submissions in company:', JSON.stringify(recentDirectSubmissions, null, 2));
      
      if (status && status !== 'all') {
        // For 'completed' status, also include 'approved' submissions (direct submissions)
        if (status === 'completed') {
          submissionQuery.$or = [
            { status: 'completed' },
            { status: 'approved' }  // Direct submissions are marked as 'approved'
          ];
        } else {
          submissionQuery.status = status;
        }
      }
      
      if (formId) {
        submissionQuery.formTemplateId = formId;
      }

      directSubmissions = await FormSubmission.find(submissionQuery)
        .populate('formTemplateId', 'title description')
        .populate('submittedBy', 'name email')
        .sort({ createdAt: -1 })
        .limit(options.limit)
        .skip((options.page - 1) * options.limit);

      directSubmissionsCount = await FormSubmission.countDocuments(submissionQuery);
      
      console.log(`✅ Found ${directSubmissionsCount} direct submissions for userId: ${userId}, userType: ${userType}`);
      
      if (directSubmissionsCount > 0 && directSubmissions.length > 0) {
        console.log('📄 First direct submission sample:', {
          relatedPersonId: directSubmissions[0].relatedPersonId,
          relatedPersonName: directSubmissions[0].relatedPersonName,
          relatedPersonType: directSubmissions[0].relatedPersonType,
          status: directSubmissions[0].status
        });
      }

      // Format direct submissions to match assignment structure
      directSubmissions = directSubmissions.map(submission => ({
        _id: submission._id,
        formTemplateId: submission.formTemplateId,
        assignedTo: {
          userId: submission.relatedPersonId,
          userName: submission.relatedPersonName,
          userType: submission.relatedPersonType
        },
        status: 'completed',
        submissionId: submission._id,
        submittedAt: submission.createdAt,
        isDirect: true, // Flag to identify direct submissions
        submittedBy: submission.submittedBy,
        metadata: submission.metadata
      }));
    }

    // Combine assignments and direct submissions
    const combinedData = [...assignmentsWithStatus, ...directSubmissions];
    const combinedTotal = total + directSubmissionsCount;

    res.status(200).json({
      success: true,
      data: combinedData,
      pagination: {
        currentPage: options.page,
        totalPages: Math.ceil(combinedTotal / options.limit),
        totalItems: combinedTotal,
        itemsPerPage: options.limit
      }
    });

  } catch (error) {
    console.error('Error fetching form assignments:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch form assignments',
      error: error.message
    });
  }
};

// Update assignment status
export const updateAssignmentStatus = async (req, res) => {
  try {
    const { assignmentId } = req.params;
    const { status, note } = req.body;
    
    // Get user's companyId from database since JWT doesn't include it
    const currentUser = await User.findById(req.user._id).select('companyId');
    if (!currentUser || !currentUser.companyId) {
      return res.status(400).json({
        success: false,
        message: 'User company information not found'
      });
    }
    const companyId = currentUser.companyId;

    if (!mongoose.Types.ObjectId.isValid(assignmentId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid assignment ID'
      });
    }

    if (!['pending', 'in-progress', 'completed', 'expired'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status value'
      });
    }

    const assignment = await FormAssignment.findOne({
      _id: assignmentId,
      companyId,
      isActive: true
    });

    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: 'Assignment not found'
      });
    }

    assignment.status = status;
    if (note) {
      assignment.assignmentNote = note;
    }

    if (status === 'completed' && !assignment.completedAt) {
      assignment.completedAt = new Date();
    }

    await assignment.save();

    res.status(200).json({
      success: true,
      message: 'Assignment status updated successfully',
      data: assignment
    });

  } catch (error) {
    console.error('Error updating assignment status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update assignment status',
      error: error.message
    });
  }
};

// Delete assignment
export const deleteAssignment = async (req, res) => {
  try {
    const { assignmentId } = req.params;
    
    // Get user's companyId from database since JWT doesn't include it
    const currentUser = await User.findById(req.user._id).select('companyId');
    if (!currentUser || !currentUser.companyId) {
      return res.status(400).json({
        success: false,
        message: 'User company information not found'
      });
    }
    const companyId = currentUser.companyId;

    if (!mongoose.Types.ObjectId.isValid(assignmentId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid assignment ID'
      });
    }

    const assignment = await FormAssignment.findOneAndUpdate(
      {
        _id: assignmentId,
        companyId,
        isActive: true
      },
      {
        isActive: false
      },
      { new: true }
    );

    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: 'Assignment not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Assignment deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting assignment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete assignment',
      error: error.message
    });
  }
};

// Get assignment statistics
export const getAssignmentStatistics = async (req, res) => {
  try {
    // Get user's companyId from database since JWT doesn't include it
    const currentUser = await User.findById(req.user._id).select('companyId');
    if (!currentUser || !currentUser.companyId) {
      return res.status(400).json({
        success: false,
        message: 'User company information not found'
      });
    }
    const companyId = currentUser.companyId;
    const { userType } = req.query;

    // Get basic stats
    const stats = await FormAssignment.getAssignmentStats(companyId, userType);
    
    // Get overdue count
    const overdueQuery = {
      companyId,
      dueDate: { $lt: new Date() },
      status: { $in: ['pending', 'in-progress'] },
      isActive: true
    };
    
    if (userType) {
      overdueQuery['assignedTo.userType'] = userType;
    }
    
    const overdueCount = await FormAssignment.countDocuments(overdueQuery);

    // Get today's assignments count
    const todayQuery = {
      companyId,
      createdAt: {
        $gte: new Date(new Date().setHours(0, 0, 0, 0)),
        $lt: new Date(new Date().setHours(23, 59, 59, 999))
      },
      isActive: true
    };
    
    if (userType) {
      todayQuery['assignedTo.userType'] = userType;
    }
    
    const todayCount = await FormAssignment.countDocuments(todayQuery);

    // Format stats
    const formattedStats = stats.reduce((acc, stat) => {
      acc[stat._id] = stat.count;
      return acc;
    }, {});

    res.status(200).json({
      success: true,
      data: {
        statusBreakdown: formattedStats,
        overdueCount,
        todayAssignments: todayCount,
        totalActive: Object.values(formattedStats).reduce((sum, count) => sum + count, 0)
      }
    });

  } catch (error) {
    console.error('Error fetching assignment statistics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch assignment statistics',
      error: error.message
    });
  }
};

// Get available users for assignment
export const getAvailableUsers = async (req, res) => {
  try {
    const { userType, search } = req.query;
    
    // Get user's companyId from database since JWT doesn't include it
    const currentUser = await User.findById(req.user._id).select('companyId');
    if (!currentUser || !currentUser.companyId) {
      return res.status(400).json({
        success: false,
        message: 'User company information not found'
      });
    }
    const companyId = currentUser.companyId;

    if (!userType || !['tenant', 'employee'].includes(userType)) {
      return res.status(400).json({
        success: false,
        message: 'Valid user type is required (tenant or employee)'
      });
    }

    let users = [];

    if (userType === 'employee') {
      // Get employees (users with role != 0)
      let query = {
        companyId,
        role: { $ne: 0 }
      };

      if (search) {
        query.$or = [
          { name: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } }
        ];
      }

      const employees = await User.find(query)
        .select('_id name email role')
        .sort({ name: 1 })
        .limit(50);

      users = employees.map(emp => ({
        id: emp._id,
        name: emp.name,
        email: emp.email,
        type: 'employee',
        role: emp.role
      }));

    } else if (userType === 'tenant') {
      // Get tenants from tenant collection
      let query = { companyId };

      if (search) {
        query.$or = [
          { 'personalInfo.firstName': { $regex: search, $options: 'i' } },
          { 'personalInfo.lastName': { $regex: search, $options: 'i' } },
          { 'personalInfo.contact.email': { $regex: search, $options: 'i' } }
        ];
      }

      const tenants = await Tenant.find(query)
        .select('_id personalInfo.firstName personalInfo.lastName personalInfo.contact.email tenantId')
        .sort({ 'personalInfo.firstName': 1 })
        .limit(50);
      users = tenants.map(tenant => ({
        id: tenant._id,
        name: `${tenant.personalInfo.firstName} ${tenant.personalInfo.lastName}`,
        email: tenant.personalInfo.contact?.email,
        tenantId: tenant.tenantId,
        type: 'tenant'
      }));

      // Also get tenant users from users collection
      const tenantUsers = await User.find({
        companyId,
        role: 0,
        ...(search && {
          $or: [
            { name: { $regex: search, $options: 'i' } },
            { email: { $regex: search, $options: 'i' } }
          ]
        })
      })
      .select('_id name email')
      .sort({ name: 1 })
      .limit(25);
      const tenantUsersFormatted = tenantUsers.map(user => ({
        id: user._id,
        name: user.name,
        email: user.email,
        type: 'tenant',
        source: 'user_account'
      }));

      users = [...users, ...tenantUsersFormatted];
    }

    res.status(200).json({
      success: true,
      data: users.slice(0, 50), // Limit to 50 results
      total: users.length
    });

  } catch (error) {
    console.error('Error fetching available users:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch available users',
      error: error.message
    });
  }
};