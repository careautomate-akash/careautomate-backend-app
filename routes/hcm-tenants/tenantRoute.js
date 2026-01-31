import express from 'express';
import { authenticateToken } from '../../middleware/auth.js';
import {
  createTenant,
  assignServicesAndDocuments,
  getServicesAndDocuments,
  updateServiceStatus,
  getAllTenants,
  getTenantNamesByCompany,
  tenantReassessments,
  assignHcmsToTenant,
  getAssignedHcmsToTenant,
  updateTenant,
  tenantProfileEditHistory,
  tenantVisitHistory,
  getTenantInfoById,
  addTenantNote,
  getTenantNotes,
  updateTenantNote,
  deleteTenantNote,
  deleteTenant,
  getTenant,
  getTenantChartInfo,
  tenantsRunningOutOfUnits,
  getAssignedHcmsServices,
  getAllMovedOutTenantsOfACompany,
  getAllMovedOutTenants,
  moveTenantOut,
  isTenantMovedOut,
  getAssignedHcmsWithServices,
  getAllServicesForTenant,
} from '../../controllers/hcm-tenants/tenantController.js';
import { uploadProfileImage } from "../../controllers/communication-documents/imageController.js"
import { uploadProfileImage as uploadMiddleware, processUpload } from '../../middleware/uploadMiddleware.js';
const router = express.Router();

// Moved Out Tenants Routes
router.get(
  '/get-all-moved-out-tenants-of-a-company/:companyId',
  authenticateToken,
  getAllMovedOutTenantsOfACompany
);
router.get(
  '/get-all-moved-out-tenants',
  authenticateToken,
  getAllMovedOutTenants
);
router.post('/move-tenant-out', authenticateToken, moveTenantOut);
router.get(
  '/is-tenant-moved-out/:tenantId',
  authenticateToken,
  isTenantMovedOut
);

// Tenant Management Routes
router.post(
  '/create-tenant',
  authenticateToken,
  processUpload,
  createTenant
);
router.get('/get-tenants/:companyId', authenticateToken, getAllTenants);
router.delete('/delete-tenant/:id', authenticateToken, deleteTenant);
router.get('/get-tenant/:id', authenticateToken, getTenant);
router.get(
  '/get-All-tenants/:companyId',
  authenticateToken,
  getTenantNamesByCompany
);

//tenant info routes
router.get(
  '/get-tenant-info/:companyId',
  authenticateToken,
  getTenantChartInfo
);

//tenant chart info
router.get(
  '/get-tenant-chart-info/:companyId',
  authenticateToken,
  getTenantChartInfo
);

router.get(
  '/tenants-running-out-of-units/:companyId',
  authenticateToken,
  tenantsRunningOutOfUnits
);

// Service Management Routes
router.post(
  '/assign-services-documents',
  authenticateToken,
  uploadMiddleware,
  assignServicesAndDocuments
);
router.post('/get-services', authenticateToken, getServicesAndDocuments);
router.post('/update-service-status', authenticateToken, updateServiceStatus);
router.post('/update-service-status', authenticateToken, updateServiceStatus);

router.get(
  '/tenant-reassessments/:companyId',
  authenticateToken,
  tenantReassessments
);
router.get(
  '/get-all-services-for-tenant/:tenantId',
  authenticateToken,
  getAllServicesForTenant
);
//assigning
router.post('/assign-hcms-to-tenant', authenticateToken, assignHcmsToTenant);
router.post(
  '/get-assigned-hcms-to-tenant',
  authenticateToken,
  getAssignedHcmsToTenant
);
router.put('/update-tenant', authenticateToken, updateTenant);
router.post(
  '/tenant-profile-edit-history',
  authenticateToken,
  tenantProfileEditHistory
);
router.post('/tenant-visit-history', authenticateToken, tenantVisitHistory);
router.post('/get-tenant-info-by-id', authenticateToken, getTenantInfoById);

router.post(
  '/get-assigned-hcms-services',
  authenticateToken,
  getAssignedHcmsServices
);

router.post(
  '/get-assigned-hcms-with-services',
  authenticateToken,
  getAssignedHcmsWithServices
);
//adding notes
router.post('/add-tenant-note', authenticateToken, addTenantNote);
router.post('/get-tenant-notes', authenticateToken, getTenantNotes);
router.post('/update-tenant-note', authenticateToken, updateTenantNote);
router.post('/delete-tenant-note', authenticateToken, deleteTenantNote);

//image upload
router.post("/upload-image", authenticateToken, uploadProfileImage);

// Simple route for form assignments - get tenant list
router.get('/list-for-forms', authenticateToken, (req, res) => {
  // This will be handled by the form assignment controller
  // Just redirect to the forms API for consistency
  res.status(302).json({
    message: 'Use /api/forms/assignments/users?userType=tenant instead'
  });
});

export default router;
