
import FormSubmission from '../models/forms/FormSubmission.js';
// import { sendSignatureNotification } from './mailService.js';
import User from '../models/account/users.js'; // Adjust path based on your user model

/**
 * Signature Workflow Service
 * Handles multi-step signature processes for forms
 */

// Detect if a form has signature fields and what type of workflow is needed
export const analyzeSignatureRequirements = (formTemplate) => {
  // Filter for all signature-related field types
  const signatureFields = formTemplate.fields.filter(field => 
    field.type === 'signature' || 
    field.type === 'staff signature' || 
    field.type === 'admin signature' ||
    field.type?.toLowerCase().includes('signature')
  );
  
  if (signatureFields.length === 0) {
    return {
      hasSignatures: false,
      workflowType: 'none',
      signatureFields: []
    };
  }

  const analysis = {
    hasSignatures: true,
    signatureFields: signatureFields,
    workflowType: 'single_step', // default
    memberSignatures: [],
    staffSignatures: [],
    adminSignatures: []
  };

  // Analyze signature fields to determine workflow type
  signatureFields.forEach(field => {
    const fieldType = field.type?.toLowerCase() || '';
    const labelLower = field.label.toLowerCase();
    
    // Check both field type and label to determine signature category
    if (fieldType.includes('staff') || labelLower.includes('staff') || labelLower.includes('employee') || labelLower.includes('nurse') || labelLower.includes('caregiver')) {
      analysis.staffSignatures.push(field);
    } else if (fieldType.includes('admin') || labelLower.includes('admin') || labelLower.includes('supervisor') || labelLower.includes('manager')) {
      analysis.adminSignatures.push(field);
    } else if (labelLower.includes('member') || labelLower.includes('tenant') || labelLower.includes('patient')) {
      analysis.memberSignatures.push(field);
    } else {
      // Default to member signature
      analysis.memberSignatures.push(field);
    }
  });

  // Determine workflow type based on signature combinations
  if (analysis.memberSignatures.length > 0 && analysis.staffSignatures.length > 0) {
    analysis.workflowType = 'member_then_staff';
  } else if (analysis.staffSignatures.length > 0 && analysis.adminSignatures.length > 0) {
    analysis.workflowType = 'staff_then_admin';
  } else if (analysis.memberSignatures.length > 0 && analysis.adminSignatures.length > 0) {
    analysis.workflowType = 'member_then_admin';
  } else if (signatureFields.length > 1) {
    analysis.workflowType = 'multi_step';
  }

  return analysis;
};

// Initialize signature workflow for a new submission
export const initializeSignatureWorkflow = async (submission, formTemplate, submitterInfo, submissionType = 'direct_complete') => {
  const analysis = analyzeSignatureRequirements(formTemplate);
  
  if (!analysis.hasSignatures) {
    return submission;
  }

  submission.signatureWorkflow = {
    hasSignatures: true,
    requiredSignatures: [],
    currentStep: 0,
    totalSteps: analysis.signatureFields.length,
    workflowStatus: 'pending_signatures'
  };

  // Initialize required signatures based on workflow type
  for (const field of analysis.signatureFields) {
    const fieldType = field.type?.toLowerCase() || '';
    const labelLower = field.label.toLowerCase();
    let signerType = 'member';
    let signerInfo = null;

    // Determine signer type and initial signer info
    // Note: Staff signatures will be assigned to admin users since we don't know the exact staff member
    if (fieldType.includes('staff') || labelLower.includes('staff') || labelLower.includes('employee')) {
      signerType = 'staff'; // Will be assigned to admin user in workflow
    } else if (fieldType.includes('admin') || labelLower.includes('admin') || labelLower.includes('supervisor')) {
      signerType = 'admin';
    } else {
      signerType = 'member';
      signerInfo = submitterInfo; // Member signs first in most cases
    }

    submission.signatureWorkflow.requiredSignatures.push({
      fieldId: field.id,
      fieldLabel: field.label,
      signerType: signerType,
      signerId: signerInfo?.userId || null,
      signerName: signerInfo?.userName || '',
      signerEmail: signerInfo?.userEmail || '',
      status: 'pending',
      notificationSent: false
    });
  }

  // Set submission type and workflow status
  submission.submissionType = submissionType;
  submission.isPartialSubmission = analysis.workflowType !== 'single_step';
  submission.awaitingSignatures = true;

  return submission;
};

// Process signature completion and determine next steps
export const processSignatureCompletion = async (submissionId, fieldId, signerInfo, signatureData) => {
  try {
    const submission = await FormSubmission.findById(submissionId)
      .populate('formTemplateId')
      .populate('submittedBy');

    if (!submission) {
      throw new Error('Form submission not found');
    }

    // Add the signature
    const completedSignature = submission.addSignature(fieldId, signerInfo, signatureData);
    
    // Save the submission
    await submission.save();

    // Check if there are more signatures needed
    const nextSignature = submission.getNextSignatureNeeded();
    
    if (nextSignature) {
      // Send notification to next signer if we can identify them
      try {
        await sendNotificationToNextSigner(submission, nextSignature);
      } catch (emailError) {
        console.error('Email notification failed (non-critical):', emailError.message);
      }
    } else {
      // All signatures completed - notify form creator and relevant parties
      // try {
      //   await sendSignatureCompletionNotification(submission);
      // } catch (emailError) {
      //   console.error('Email notification failed (non-critical):', emailError.message);
      // }
    }

    return {
      success: true,
      submission: submission,
      nextSignature: nextSignature,
      allSignaturesCompleted: !nextSignature
    };
  } catch (error) {
    console.error('Error processing signature completion:', error);
    throw error;
  }
};

// Send notification to the next signer in the workflow
const sendNotificationToNextSigner = async (submission, nextSignature) => {
  try {
    let notificationSent = false;

    // If we don't have a specific signer, find appropriate admin user for staff signatures
    if (!nextSignature.signerId && nextSignature.signerType === 'staff') {
      // Assign all staff signatures to admin since we don't know the exact person
      const adminUsers = await findAvailableAdmins(submission.companyId);
      
      if (adminUsers.length > 0) {
        // Assign to first available admin
        const adminUser = adminUsers[0];
        
        nextSignature.signerId = adminUser._id;
        nextSignature.signerName = adminUser.name;
        nextSignature.signerEmail = adminUser.email;
        
        // await sendSignatureNotification({
        //   to: adminUser.email,
        //   userName: adminUser.name,
        //   formTitle: submission.formTemplateId.title,
        //   submittedBy: submission.submittedBy?.name || 'Anonymous',
        //   submissionId: submission._id,
        //   signatureField: nextSignature.fieldLabel,
        //   dueDate: null // You can add due date logic here
        // });
        
        notificationSent = true;
      }
    } else if (!nextSignature.signerId && nextSignature.signerType === 'admin') {
      // For admin signatures, find available admins
      const adminUsers = await findAvailableAdmins(submission.companyId);
      
      if (adminUsers.length > 0) {
        // Assign to first available admin
        const adminUser = adminUsers[0];
        
        nextSignature.signerId = adminUser._id;
        nextSignature.signerName = adminUser.name;
        nextSignature.signerEmail = adminUser.email;
        
        // await sendSignatureNotification({
        //   to: adminUser.email,
        //   userName: adminUser.name,
        //   formTitle: submission.formTemplateId.title,
        //   submittedBy: submission.submittedBy?.name || 'Anonymous',
        //   submissionId: submission._id,
        //   signatureField: nextSignature.fieldLabel,
        //   dueDate: null
        // });
        
        notificationSent = true;
      }
    } else if (nextSignature.signerId && nextSignature.signerEmail) {
      // Send notification to specified signer
      // await sendSignatureNotification({
      //   to: nextSignature.signerEmail,
      //   userName: nextSignature.signerName,
      //   formTitle: submission.formTemplateId.title,
      //   submittedBy: submission.submittedBy?.name || 'Anonymous',
      //   submissionId: submission._id,
      //   signatureField: nextSignature.fieldLabel,
      //   dueDate: null
      // });
      
      notificationSent = true;
    }

    // Update notification status
    if (notificationSent) {
      nextSignature.notificationSent = true;
      nextSignature.notificationSentAt = new Date();
      await submission.save();
    }

    return notificationSent;
  } catch (error) {
    console.error('Error sending notification to next signer:', error);
    return false;
  }
};

// Find available admin users for signature assignment
const findAvailableAdmins = async (companyId) => {
  try {
    // Query for admin users only (role 1)
    const adminUsers = await User.find({
      companyId: companyId,
      role: 1, // Admin role only
      movedOut: { $ne: true }
    }).select('name email role');
    
    return adminUsers;
  } catch (error) {
    console.error('Error finding available admins:', error);
    return [];
  }
};

// Deprecated: No longer used - staff signatures are now assigned to admins
// Find available staff members for signature
const findAvailableStaff = async (companyId) => {
  try {
    // Adjust query based on your user model structure
    // Role 2 and 3 are typically staff/employee roles, role 1 is admin
    const staffUsers = await User.find({
      companyId: companyId,
      role: { $in: [1, 2, 3] }, // Include admin, staff, and employee roles
      movedOut: { $ne: true } // Exclude moved out users (only applies to role 0)
    }).select('name email role');
    
    return staffUsers;
  } catch (error) {
    console.error('Error finding available staff:', error);
    return [];
  }
};

// Get signature status for a submission
export const getSignatureStatus = async (submissionId) => {
  try {
    const submission = await FormSubmission.findById(submissionId)
      .populate('formTemplateId', 'title')
      .populate('submittedBy', 'name email');

    if (!submission) {
      throw new Error('Form submission not found');
    }

    return {
      submissionId: submission._id,
      formTitle: submission.formTemplateId?.title,
      hasSignatures: submission.signatureWorkflow?.hasSignatures || false,
      workflowStatus: submission.signatureWorkflow?.workflowStatus || 'completed',
      currentStep: submission.signatureWorkflow?.currentStep || 0,
      totalSteps: submission.signatureWorkflow?.totalSteps || 0,
      requiredSignatures: submission.signatureWorkflow?.requiredSignatures || [],
      awaitingSignatures: submission.awaitingSignatures,
      isPartialSubmission: submission.isPartialSubmission,
      submissionType: submission.submissionType
    };
  } catch (error) {
    console.error('Error getting signature status:', error);
    throw error;
  }
};

// Get pending signatures for a user
// Get pending signatures for a user
export const getPendingSignaturesForUser = async (userId, userType, companyId) => {
  try {
    const submissions = await FormSubmission.findPendingSignatures(userId, userType, companyId);
    
    return submissions.map(submission => {
      const pendingSignatures = submission.signatureWorkflow?.requiredSignatures?.filter(
        sig => sig.status === 'pending' && (
          sig.signerId?.toString() === userId.toString() || 
          // Admin users see both admin and staff signatures (since staff are assigned to admin)
          (userType === 'admin' && (sig.signerType === 'admin' || sig.signerType === 'staff') && !sig.signerId) ||
          // Member signatures only for members
          (sig.signerType === userType && !sig.signerId)
        )
      ) || [];

      return {
        submissionId: submission._id,
        formId: submission.formTemplateId?._id,
        formTitle: submission.formTemplateId?.title,
        submittedBy: submission.submittedBy?.name || 'Anonymous',
        submittedAt: submission.createdAt,
        pendingSignatures: pendingSignatures,
        priority: submission.metadata?.priority || 'normal'
      };
    });
  } catch (error) {
    console.error('Error getting pending signatures for user:', error);
    throw error;
  }
};

// Handle direct form completion (when member and staff are together)
export const handleDirectCompletion = async (submission, allSignatures) => {
  try {
    if (!submission.signatureWorkflow?.hasSignatures) {
      return submission;
    }

    // Process all signatures at once
    for (const signatureData of allSignatures) {
      const { fieldId, signerInfo, signature } = signatureData;
      submission.addSignature(fieldId, signerInfo, signature);
    }

    // Mark as direct completion
    submission.submissionType = 'direct_complete';
    submission.isPartialSubmission = false;
    submission.awaitingSignatures = false;

    await submission.save();

    // Send completion notification
    // try {
    //   await sendSignatureCompletionNotification(submission);
    // } catch (emailError) {
    //   console.error('Email notification failed (non-critical):', emailError.message);
    // }

    return submission;
  } catch (error) {
    console.error('Error handling direct completion:', error);
    throw error;
  }
};

export default {
  analyzeSignatureRequirements,
  initializeSignatureWorkflow,
  processSignatureCompletion,
  getSignatureStatus,
  getPendingSignaturesForUser,
  handleDirectCompletion
};