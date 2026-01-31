import express from 'express';
import formTemplateRoutes from './formTemplateRoutes.js';
import formSubmissionRoutes from './formSubmissionRoutes.js';
import formAssignmentRoutes from './formAssignmentRoutes.js';

const router = express.Router();

// Mount template routes
router.use('/', formTemplateRoutes);

// Mount submission routes  
router.use('/', formSubmissionRoutes);

// Mount assignment routes
router.use('/', formAssignmentRoutes);

// Health check endpoint
router.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Forms API is healthy',
    timestamp: new Date().toISOString()
  });
});

export default router;