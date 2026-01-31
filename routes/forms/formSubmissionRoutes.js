import express from 'express';
import {
  submitForm,
  getFormSubmissions,
  getSubmission,
  updateSubmissionStatus,
  deleteSubmission,
  getUserSubmissions,
  exportSubmissions,
  completeSignature,
  getPendingSignatures,
  getSignatureStatus
} from '../../controllers/forms/formSubmissionController.js';
import { authenticateToken } from '../../middleware/auth.js';

const router = express.Router();

// Public route for form submission (may be authenticated or anonymous)
router.post('/submit', (req, res, next) => {
  // Try to authenticate but don't require it
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    authenticateToken(req, res, next);
  } else {
    next();
  }
}, submitForm);

// All other routes require authentication
router.use(authenticateToken);

// GET /api/forms/submissions/my - Get user's own submissions
router.get('/submissions/my', getUserSubmissions);

// GET /api/forms/submissions/pending-signatures - Get pending signatures for current user
// NOTE: Must be before /submissions/:id to avoid matching "pending-signatures" as an ID
router.get('/submissions/pending-signatures', getPendingSignatures);

// GET /api/forms/submissions/form/:formId - Get all submissions for a form
router.get('/submissions/form/:formId', getFormSubmissions);

// GET /api/forms/submissions/form/:formId/export - Export submissions as CSV
router.get('/submissions/form/:formId/export', exportSubmissions);

// Signature-related routes
// POST /api/forms/submissions/:submissionId/signature/:fieldId - Complete a signature
router.post('/submissions/:submissionId/signature/:fieldId', completeSignature);

// GET /api/forms/submissions/:submissionId/signature-status - Get signature status
router.get('/submissions/:submissionId/signature-status', getSignatureStatus);

// GET /api/forms/submissions/:id - Get specific submission
// NOTE: Must be after specific routes like /pending-signatures and /form/:formId
router.get('/submissions/:id', getSubmission);

// PATCH /api/forms/submissions/:id/status - Update submission status
router.patch('/submissions/:id/status', updateSubmissionStatus);

// DELETE /api/forms/submissions/:id - Delete submission
router.delete('/submissions/:id', deleteSubmission);

export default router;