import FormSubmission from '../../models/forms/FormSubmission.js';
import FormTemplate from '../../models/forms/FormTemplate.js';
import FormAssignment from '../../models/forms/FormAssignment.js';
import mongoose from 'mongoose';

// Utility function to convert MongoDB Map to plain object
const convertMapToObject = (submission) => {
  if (!submission) return null;
  
  // Handle array of submissions
  if (Array.isArray(submission)) {
    return submission.map(convertMapToObject);
  }
  
  // Convert single submission
  const result = typeof submission.toObject === 'function' ? submission.toObject() : submission;
  
  if (result.data) {
    if (result.data instanceof Map) {
      result.data = Object.fromEntries(result.data);
    } else if (typeof result.data === 'object' && result.data.constructor === Object) {
      // Handle MongoDB objects that need JSON parsing
      result.data = JSON.parse(JSON.stringify(result.data));
    }
  }
  
  return result;
};

import { 
  initializeSignatureWorkflow, 
  handleDirectCompletion, 
  analyzeSignatureRequirements 
} from '../../services/signatureWorkflowService.js';

// Submit a form
export const submitForm = async (req, res) => {
  try {
    const { 
      formTemplateId, 
      data, 
      metadata, 
      assignmentId, 
      userType,
      signatures = [], // Array of signatures for direct completion
      submissionType = 'direct_complete' // 'direct_complete', 'member_first', 'staff_first'
    } = req.body;
    
    const userId = req.user?._id; // Optional for anonymous submissions
    const companyId = req.user?.companyId || metadata?.companyId;
    const userRole = req.user?.role;

    // Validate required fields
    if (!formTemplateId || !data) {
      return res.status(400).json({
        success: false,
        message: 'Form template ID and data are required'
      });
    }

    if (!mongoose.Types.ObjectId.isValid(formTemplateId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid form template ID'
      });
    }

    // Check if form template exists and is active
    const formTemplate = await FormTemplate.findOne({
      _id: formTemplateId,
      isActive: true,
      status: 'published'
    });

    if (!formTemplate) {
      return res.status(404).json({
        success: false,
        message: 'Form template not found or not available for submission'
      });
    }

    // Analyze signature requirements
    const signatureAnalysis = analyzeSignatureRequirements(formTemplate);

    // If assignmentId is provided, validate the assignment
    let assignment = null;
    if (assignmentId) {
      if (!mongoose.Types.ObjectId.isValid(assignmentId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid assignment ID'
        });
      }

      // If user is authenticated, validate user matches assignment or allow admin/employee override
      if (userId && userType) {
        // Validate userType is valid
        if (!['tenant', 'employee'].includes(userType)) {
          return res.status(400).json({
            success: false,
            message: 'Invalid user type. Must be "tenant" or "employee"'
          });
        }
        
        // First try to find assignment for the current user
        assignment = await FormAssignment.findOne({
          _id: assignmentId,
          formTemplateId,
          'assignedTo.userId': userId,
          'assignedTo.userType': userType,
          isActive: true,
          status: { $in: ['pending', 'in-progress'] }
        });
        
        // If not found and user is admin/employee (role 2), allow completing assignments for others
        if (!assignment && (userRole === 2 || userRole === 1)) {
          assignment = await FormAssignment.findOne({
            _id: assignmentId,
            formTemplateId,
            isActive: true,
            status: { $in: ['pending', 'in-progress'] }
          });
        }
      } else {
        // For anonymous/unauthenticated requests, just check assignment exists and is valid
        assignment = await FormAssignment.findOne({
          _id: assignmentId,
          formTemplateId,
          isActive: true,
          status: { $in: ['pending', 'in-progress'] }
        });
        
      }

      if (!assignment) {
        return res.status(404).json({
          success: false,
          message: 'Assignment not found or already completed'
        });
      }
    }

    // Validate required fields in the submission (excluding signatures for now)
    const requiredFields = formTemplate.fields.filter(field => field.required && field.type !== 'signature');
    const missingFields = [];

    for (const field of requiredFields) {
      const value = data[field.id];
      if (!value || (typeof value === 'string' && value.trim() === '')) {
        missingFields.push(field.label);
      }
    }

    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Missing required fields: ${missingFields.join(', ')}`
      });
    }

    // Prepare submitter information for signature workflow
    const submitterInfo = userId ? {
      userId: userId,
      userName: req.user?.name || 'User',
      userEmail: req.user?.email || '',
      userType: userType || 'member'
    } : null;

    // Extract related person information from metadata
    const relatedPersonId = metadata?.relatedPersonId || null;
    const relatedPersonName = metadata?.relatedPersonName || null;
    const relatedPersonType = metadata?.relatedTo || metadata?.formType || null;

    // Validate and convert relatedPersonId to ObjectId if provided
    let relatedPersonObjectId = null;
    if (relatedPersonId) {
      if (mongoose.Types.ObjectId.isValid(relatedPersonId)) {
        relatedPersonObjectId = new mongoose.Types.ObjectId(relatedPersonId);
      } else {
        return res.status(400).json({
          success: false,
          message: 'Invalid relatedPersonId format'
        });
      }
    }

    // Check if this is a direct completion (either with signatures or marked as direct_complete)
    const isDirectComplete = (metadata?.hasStaffSignature && metadata?.hasMemberSignature) || 
                             (submissionType === 'direct_complete' && relatedPersonObjectId);

    // Create submission with signature workflow support
    const submissionData = {
      formTemplateId,
      data: new Map(Object.entries(data)),
      submittedBy: userId,
      companyId,
      assignmentId: assignment?._id,
      relatedPersonId: relatedPersonObjectId,
      relatedPersonName: relatedPersonName,
      relatedPersonType: relatedPersonType,
      metadata: {
        ...metadata,
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('User-Agent'),
        submissionSource: assignment ? 'assignment' : 'direct',
        assignmentCompleted: !!assignment,
        hasSignatures: signatureAnalysis.hasSignatures,
        signatureWorkflowType: signatureAnalysis.workflowType
      }
    };

    const submission = new FormSubmission(submissionData);

    // Initialize signature workflow if form has signatures AND not direct complete
    if (signatureAnalysis.hasSignatures && !isDirectComplete) {
      await initializeSignatureWorkflow(submission, formTemplate, submitterInfo, submissionType);
      
      // Auto-complete member signatures if they're provided in the submission data
      if (submitterInfo && submission.signatureWorkflow?.requiredSignatures) {
        
        for (const reqSig of submission.signatureWorkflow.requiredSignatures) {
          // Check if this is a member signature and data was provided
          if (reqSig.signerType === 'member' && reqSig.signerId && userId) {
            // Compare using string representation to handle ObjectId comparison
            const signerIdStr = reqSig.signerId.toString();
            const userIdStr = userId.toString();
            
            
            if (signerIdStr === userIdStr) {
              const signatureData = data[reqSig.fieldId];
              if (signatureData && typeof signatureData === 'string' && signatureData.startsWith('data:image')) {
                // Auto-complete this signature
                try {
                  submission.addSignature(reqSig.fieldId, submitterInfo, signatureData);
                } catch (error) {
                  console.error('✗ Error auto-completing member signature:', error.message);
                }
              } else {
                console.log('Signature data not valid or missing');
              }
            }
          }
        }
      }

      // Handle different submission scenarios
      if (submissionType === 'direct_complete' && signatures.length > 0) {
        // All signatures provided at once (member and staff together)
        await handleDirectCompletion(submission, signatures);
      } else {
        // Set initial status based on submission type
        if (signatureAnalysis.memberSignatures.length > 0) {
          submission.status = 'submitted'; // Waiting for signatures to complete
        }
      }
    } else if (isDirectComplete) {
      // Direct completion - mark as approved immediately
      console.log('✅ Direct complete submission detected');
      console.log('📝 Related Person:', { relatedPersonObjectId, relatedPersonName, relatedPersonType });
      
      submission.status = 'approved';
      submission.awaitingSignatures = false;
      submission.signatureWorkflow = {
        hasSignatures: signatureAnalysis.hasSignatures,
        workflowStatus: 'fully_signed',
        completedAt: new Date()
      };
    } else if (!signatureAnalysis.hasSignatures && relatedPersonObjectId) {
      // Form without signatures but has relatedPerson - mark as approved
      console.log('✅ Form without signatures submitted for related person');
      console.log('📝 Related Person:', { relatedPersonObjectId, relatedPersonName, relatedPersonType });
      
      submission.status = 'approved';
      submission.awaitingSignatures = false;
    }

    const savedSubmission = await submission.save();
    
    console.log('💾 Submission saved with ID:', savedSubmission._id);
    console.log('📋 Submission details:', {
      relatedPersonId: savedSubmission.relatedPersonId,
      relatedPersonName: savedSubmission.relatedPersonName,
      relatedPersonType: savedSubmission.relatedPersonType,
      status: savedSubmission.status,
      assignmentId: savedSubmission.assignmentId,
      isDeleted: savedSubmission.isDeleted,
      companyId: savedSubmission.companyId,
      isDirect: !savedSubmission.assignmentId
    });
    
    // Verify if this is truly a direct submission
    if (!savedSubmission.assignmentId && savedSubmission.relatedPersonId) {
      console.log('✅ This IS a direct submission - should be queryable');
    } else if (savedSubmission.assignmentId) {
      console.log('⚠️ This is NOT a direct submission - has assignmentId:', savedSubmission.assignmentId);
    } else {
      console.log('⚠️ Missing relatedPersonId - will not be queryable as direct submission');
    }

    // If this submission is for an assignment, mark the assignment as completed only if no pending signatures
    if (assignment && !savedSubmission.awaitingSignatures) {
      await assignment.markAsCompleted(savedSubmission._id);
    }

    // Prepare response message based on signature workflow status
    let message = 'Form submitted successfully';
    let additionalInfo = {};

    if (signatureAnalysis.hasSignatures) {
      if (savedSubmission.awaitingSignatures) {
        const nextSignature = savedSubmission.getNextSignatureNeeded();
        message = 'Form submitted successfully. Waiting for signatures to complete.';
        additionalInfo = {
          awaitingSignatures: true,
          nextSignatureNeeded: nextSignature ? {
            fieldLabel: nextSignature.fieldLabel,
            signerType: nextSignature.signerType,
            signerName: nextSignature.signerName
          } : null,
          totalSignatures: savedSubmission.signatureWorkflow.totalSteps,
          completedSignatures: savedSubmission.signatureWorkflow.currentStep
        };
      } else {
        message = 'Form submitted and all signatures completed successfully';
        additionalInfo = {
          allSignaturesCompleted: true,
          totalSignatures: savedSubmission.signatureWorkflow.totalSteps
        };
      }
    }

    if (assignment && savedSubmission.awaitingSignatures) {
      message += ' Assignment will be marked complete once all signatures are collected.';
    } else if (assignment) {
      message += ' Assignment completed.';
    }

    res.status(201).json({
      success: true,
      message: message,
      data: {
        id: savedSubmission._id,
        submissionId: savedSubmission._id,
        submittedAt: savedSubmission.createdAt,
        assignmentCompleted: assignment ? !savedSubmission.awaitingSignatures : false,
        assignmentId: assignment?._id,
        hasSignatures: signatureAnalysis.hasSignatures,
        signatureWorkflow: signatureAnalysis.hasSignatures ? {
          workflowStatus: savedSubmission.signatureWorkflow.workflowStatus,
          currentStep: savedSubmission.signatureWorkflow.currentStep,
          totalSteps: savedSubmission.signatureWorkflow.totalSteps,
          awaitingSignatures: savedSubmission.awaitingSignatures
        } : null,
        ...additionalInfo
      }
    });
  } catch (error) {
    console.error('Error submitting form:', error);
    
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        error: Object.values(error.errors).map(err => err.message)
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to submit form',
      error: error.message
    });
  }
};

// Get all submissions for a form (for form owners)
export const getFormSubmissions = async (req, res) => {
  try {
    const { formId } = req.params;
    const { page = 1, limit = 10, status, dateFrom, dateTo } = req.query;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(formId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid form ID'
      });
    }

    // Verify form ownership
    const formTemplate = await FormTemplate.findOne({
      _id: formId,
      createdBy: userId,
      isActive: true
    });

    if (!formTemplate) {
      return res.status(404).json({
        success: false,
        message: 'Form not found or you do not have permission to view its submissions'
      });
    }

    // Build query options
    const options = {
      status,
      dateFrom,
      dateTo,
      limit: parseInt(limit)
    };

    // Get submissions
    const submissions = await FormSubmission.findByForm(formId, options);
    const convertedSubmissions = convertMapToObject(submissions);
    
    const totalSubmissions = await FormSubmission.countDocuments({
      formTemplateId: formId,
      isDeleted: false,
      ...(status && { status }),
      ...(dateFrom && { createdAt: { $gte: new Date(dateFrom) } }),
      ...(dateTo && { createdAt: { ...{ createdAt: { $gte: new Date(dateFrom) } }, $lte: new Date(dateTo) } })
    });

    res.status(200).json({
      success: true,
      data: convertedSubmissions,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalSubmissions / options.limit),
        totalItems: totalSubmissions,
        itemsPerPage: options.limit
      },
      formInfo: {
        id: formTemplate._id,
        title: formTemplate.title,
        description: formTemplate.description
      }
    });
  } catch (error) {
    console.error('Error fetching form submissions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch form submissions',
      error: error.message
    });
  }
};

// Get a specific submission
export const getSubmission = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid submission ID'
      });
    }

    const submission = await FormSubmission.findOne({
      _id: id,
      isDeleted: false
    })
      .populate('formTemplateId', 'title description fields createdBy')
      .populate('submittedBy', 'name email')
      .populate('reviewedBy', 'name email');

    if (!submission) {
      return res.status(404).json({
        success: false,
        message: 'Submission not found'
      });
    }

    // Check permissions - user can view if they own the form or made the submission
    const canView = 
      submission.formTemplateId.createdBy.toString() === userId.toString() ||
      (submission.submittedBy && submission.submittedBy._id.toString() === userId.toString());

    if (!canView) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view this submission'
      });
    }

    // Convert Map to plain object for proper JSON serialization
    const submissionData = convertMapToObject(submission);

    res.status(200).json({
      success: true,
      data: submissionData
    });
  } catch (error) {
    console.error('Error fetching submission:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch submission',
      error: error.message
    });
  }
};

// Update submission status (for form owners)
export const updateSubmissionStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, reviewNotes } = req.body;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid submission ID'
      });
    }

    const validStatuses = ['submitted', 'reviewed', 'approved', 'rejected', 'processing'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
      });
    }

    // Find submission and check ownership
    const submission = await FormSubmission.findOne({
      _id: id,
      isDeleted: false
    }).populate('formTemplateId', 'createdBy');

    if (!submission) {
      return res.status(404).json({
        success: false,
        message: 'Submission not found'
      });
    }

    if (submission.formTemplateId.createdBy.toString() !== userId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to update this submission'
      });
    }

    // Update submission
    const updateData = {
      status,
      reviewedBy: userId,
      reviewedAt: new Date()
    };

    if (reviewNotes) {
      updateData.reviewNotes = reviewNotes;
    }

    const updatedSubmission = await FormSubmission.findByIdAndUpdate(
      id,
      updateData,
      { new: true }
    )
      .populate('formTemplateId', 'title description')
      .populate('submittedBy', 'name email')
      .populate('reviewedBy', 'name email');

    const convertedSubmission = convertMapToObject(updatedSubmission);

    res.status(200).json({
      success: true,
      message: 'Submission status updated successfully',
      data: convertedSubmission
    });
  } catch (error) {
    console.error('Error updating submission status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update submission status',
      error: error.message
    });
  }
};

// Delete a submission (soft delete)
export const deleteSubmission = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid submission ID'
      });
    }

    const submission = await FormSubmission.findOne({
      _id: id,
      isDeleted: false
    }).populate('formTemplateId', 'createdBy');

    if (!submission) {
      return res.status(404).json({
        success: false,
        message: 'Submission not found'
      });
    }

    // Check permissions - only form owner can delete submissions
    if (submission.formTemplateId.createdBy.toString() !== userId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to delete this submission'
      });
    }

    // Soft delete
    submission.isDeleted = true;
    submission.deletedAt = new Date();
    submission.deletedBy = userId;
    await submission.save();

    res.status(200).json({
      success: true,
      message: 'Submission deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting submission:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete submission',
      error: error.message
    });
  }
};

// Get user's own submissions
export const getUserSubmissions = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const userId = req.user._id;
    const companyId = req.user.companyId;

    const submissions = await FormSubmission.findByUser(userId, companyId);
    const convertedSubmissions = convertMapToObject(submissions);

    // Count should match the findByUser query logic
    const total = await FormSubmission.countDocuments({
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
    });

    res.status(200).json({
      success: true,
      data: convertedSubmissions,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        totalItems: total,
        itemsPerPage: parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Error fetching user submissions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch your submissions',
      error: error.message
    });
  }
};

// Export submissions as CSV
export const exportSubmissions = async (req, res) => {
  try {
    const { formId } = req.params;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(formId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid form ID'
      });
    }

    // Verify form ownership
    const formTemplate = await FormTemplate.findOne({
      _id: formId,
      createdBy: userId,
      isActive: true
    });

    if (!formTemplate) {
      return res.status(404).json({
        success: false,
        message: 'Form not found or you do not have permission to export its submissions'
      });
    }

    // Get all submissions
    const submissions = await FormSubmission.find({
      formTemplateId: formId,
      isDeleted: false
    })
      .populate('submittedBy', 'name email')
      .sort({ createdAt: -1 });

    // Prepare CSV data
    const csvData = [];
    
    // Header row
    const headers = ['Submission ID', 'Submitted By', 'Email', 'Submitted At', 'Status'];
    
    // Add signature workflow columns
    headers.push('Has Signatures', 'Signature Status', 'Completed Signatures', 'Total Signatures', 'Awaiting Signatures');
    
    formTemplate.fields.forEach(field => {
      headers.push(field.label);
      if (field.type === 'signature') {
        headers.push(`${field.label} - Signer`, `${field.label} - Signed At`);
      }
    });
    csvData.push(headers);

    // Data rows
    submissions.forEach(submission => {
      const row = [
        submission._id.toString(),
        submission.submittedBy?.name || 'Anonymous',
        submission.submittedBy?.email || 'N/A',
        submission.createdAt.toISOString(),
        submission.status
      ];
      
      // Add signature workflow data
      row.push(
        submission.signatureWorkflow?.hasSignatures || false,
        submission.signatureWorkflow?.workflowStatus || 'N/A',
        submission.signatureWorkflow?.currentStep || 0,
        submission.signatureWorkflow?.totalSteps || 0,
        submission.awaitingSignatures || false
      );
      
      // Convert Map to object if needed
      let submissionData = submission.data;
      if (submissionData instanceof Map) {
        submissionData = Object.fromEntries(submissionData);
      }
      
      formTemplate.fields.forEach(field => {
        const value = submissionData[field.id] || '';
        row.push(typeof value === 'object' ? JSON.stringify(value) : value);
        
        if (field.type === 'signature') {
          // Find signature info
          const signatureInfo = submission.signatureWorkflow?.requiredSignatures?.find(
            sig => sig.fieldId === field.id
          );
          row.push(signatureInfo?.signerName || 'N/A');
          row.push(signatureInfo?.signedAt ? new Date(signatureInfo.signedAt).toISOString() : 'N/A');
        }
      });
      
      csvData.push(row);
    });

    // Convert to CSV string
    const csvString = csvData.map(row => 
      row.map(field => `"${String(field).replace(/"/g, '""')}"`).join(',')
    ).join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${formTemplate.title}_submissions_${new Date().toISOString().split('T')[0]}.csv"`);
    res.status(200).send(csvString);
  } catch (error) {
    console.error('Error exporting submissions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to export submissions',
      error: error.message
    });
  }
};

// Complete a signature for a pending submission
export const completeSignature = async (req, res) => {
  try {
    const { submissionId, fieldId } = req.params;
    const { signatureData } = req.body;
    const userId = req.user._id;
    const userName = req.user.name || 'User';
    const userEmail = req.user.email || '';

    if (!mongoose.Types.ObjectId.isValid(submissionId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid submission ID'
      });
    }

    if (!signatureData) {
      return res.status(400).json({
        success: false,
        message: 'Signature data is required'
      });
    }

    // Import signature workflow service functions
    const { processSignatureCompletion } = await import('../../services/signatureWorkflowService.js');

    // Process the signature
    const result = await processSignatureCompletion(
      submissionId,
      fieldId,
      { userId, userName, userEmail },
      signatureData
    );

    // If all signatures are completed and this submission is linked to an assignment, mark assignment as completed
    if (result.allSignaturesCompleted && result.submission.assignmentId) {
      try {
        const assignment = await FormAssignment.findById(result.submission.assignmentId);
        
        if (assignment && assignment.status !== 'completed') {
          await assignment.markAsCompleted(result.submission._id);
          console.log(`Assignment ${assignment._id} marked as completed after all signatures collected`);
        }
      } catch (assignmentError) {
        console.error('Error updating assignment status:', assignmentError);
        // Don't fail the signature completion if assignment update fails
      }
    }

    res.status(200).json({
      success: true,
      message: result.allSignaturesCompleted 
        ? 'Signature completed successfully. All signatures are now complete!'
        : 'Signature completed successfully. Awaiting additional signatures.',
      data: {
        submissionId: result.submission._id,
        signatureCompleted: true,
        allSignaturesCompleted: result.allSignaturesCompleted,
        nextSignature: result.nextSignature ? {
          fieldId: result.nextSignature.fieldId,
          fieldLabel: result.nextSignature.fieldLabel,
          signerType: result.nextSignature.signerType
        } : null,
        workflowStatus: result.submission.signatureWorkflow.workflowStatus,
        currentStep: result.submission.signatureWorkflow.currentStep,
        totalSteps: result.submission.signatureWorkflow.totalSteps
      }
    });
  } catch (error) {
    console.error('Error completing signature:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to complete signature',
      error: error.message
    });
  }
};

// Get pending signatures for the current user
export const getPendingSignatures = async (req, res) => {
  try {
    const userId = req.user._id;
    const userRole = req.user.role;
    const companyId = req.user.companyId;

    // Determine user type based on role
    let userType = 'member';
    if (userRole === 2 || userRole === 3) {
      userType = 'staff';
    } else if (userRole === 1) {
      userType = 'admin';
    }

    // Import signature workflow service function
    const { getPendingSignaturesForUser } = await import('../../services/signatureWorkflowService.js');

    const pendingSignatures = await getPendingSignaturesForUser(userId, userType, companyId);

    res.status(200).json({
      success: true,
      data: pendingSignatures,
      count: pendingSignatures.length
    });
  } catch (error) {
    console.error('Error getting pending signatures:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get pending signatures',
      error: error.message
    });
  }
};

// Get signature status for a submission
export const getSignatureStatus = async (req, res) => {
  try {
    const { submissionId } = req.params;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(submissionId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid submission ID'
      });
    }

    const submission = await FormSubmission.findOne({
      _id: submissionId,
      isDeleted: false
    })
      .populate('formTemplateId', 'title description createdBy')
      .populate('submittedBy', 'name email');

    if (!submission) {
      return res.status(404).json({
        success: false,
        message: 'Submission not found'
      });
    }

    // Check permissions - user can view if they own the form, made the submission, or are assigned to sign
    const canView = 
      submission.formTemplateId.createdBy.toString() === userId.toString() ||
      (submission.submittedBy && submission.submittedBy._id.toString() === userId.toString()) ||
      (submission.signatureWorkflow?.requiredSignatures?.some(sig => 
        sig.signerId?.toString() === userId.toString() || 
        (sig.signerType && !sig.signerId) // Unassigned signature that user might complete
      ));

    if (!canView) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view this submission'
      });
    }

    // Import signature workflow service function
    const { getSignatureStatus: getSignatureStatusService } = await import('../../services/signatureWorkflowService.js');
    const signatureStatus = await getSignatureStatusService(submissionId);

    res.status(200).json({
      success: true,
      data: signatureStatus
    });
  } catch (error) {
    console.error('Error getting signature status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get signature status',
      error: error.message
    });
  }
};