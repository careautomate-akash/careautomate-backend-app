import express from 'express';
import {
  getFormTemplates,
  getFormTemplate,
  createFormTemplate,
  updateFormTemplate,
  deleteFormTemplate,
  duplicateFormTemplate,
  getFormStatistics
} from '../../controllers/forms/formTemplateController.js';
import { authenticateToken } from '../../middleware/auth.js';

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// GET /api/forms/templates - Get all form templates for user
router.get('/templates', getFormTemplates);

// GET /api/forms/templates/:id - Get specific form template
router.get('/templates/:id', getFormTemplate);

// POST /api/forms/templates - Create new form template
router.post('/templates', createFormTemplate);

// PUT /api/forms/templates/:id - Update form template
router.put('/templates/:id', updateFormTemplate);

// DELETE /api/forms/templates/:id - Delete form template
router.delete('/templates/:id', deleteFormTemplate);

// POST /api/forms/templates/:id/duplicate - Duplicate form template
router.post('/templates/:id/duplicate', duplicateFormTemplate);

// GET /api/forms/templates/:id/statistics - Get form statistics
router.get('/templates/:id/statistics', getFormStatistics);

// GET /api/forms/public/:id - Get public form template (for filling out)
router.get('/public/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const FormTemplate = (await import('../../models/forms/FormTemplate.js')).default;
    
    const form = await FormTemplate.findOne({
      _id: id,
      status: 'published',
      isActive: true
    }).select('title description fields settings');
    
    if (!form) {
      return res.status(404).json({
        success: false,
        message: 'Form not found or not available'
      });
    }
    
    res.json({
      success: true,
      data: form
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching form',
      error: error.message
    });
  }
});

export default router;