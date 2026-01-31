// routes/visitRoutes.js
// routes/visitRoutes.js
// routes/visitRoutes.js
import express from 'express';
import {
  updateVisit,
  deleteVisit,
  visitsWaitingForApproval,
  getVisitsComplianceReports,
  getVisits,
  getVisitsCompliance,
  filterVisits,
  getVisitsCount,
  withdrawMarkedVisitAsApproved,
  withdrawMarkedVisitAsRejected,
  markVisitAsRejected,
  getAllServiceTypes,
  getServiceTypeMapping,
  getPredefinedActivities,
  markVisitApproved,
  getVisitById,
  getVisitSignatureImage,
  getVisitCount,
  createVisit,
} from '../../controllers/appointments-visits/visitsController.js';
import { authenticateToken } from '../../middleware/auth.js';
import {
  uploadSignatureImage,
  processUpload,
} from '../../middleware/uploadMiddleware.js';

const router = express.Router();

router.post(
  '/create-visit',
  authenticateToken,
  uploadSignatureImage,
  processUpload,
  createVisit
);

router.get('/get-visits/:companyId', authenticateToken, getVisits);

router.delete('/delete-visit/:id', authenticateToken, deleteVisit);

router.put(
  '/update-visit/:id',
  authenticateToken,
  uploadSignatureImage,
  processUpload,
  updateVisit
);

router.get(
  '/signature-image/:visitId',
  authenticateToken,
  getVisitSignatureImage
);

router.get(
  '/visits-waiting-for-approval/:companyId',
  authenticateToken,
  visitsWaitingForApproval
);

router.post('/mark-visit-as-approved/', markVisitApproved);

router.post('/mark-visit-as-rejected/', markVisitAsRejected);

router.post(
  '/withdraw-marked-visit-as-approved/',
  withdrawMarkedVisitAsApproved
);

router.get('/get-visit-by-id/:id', authenticateToken, getVisitById);

router.post(
  '/withdraw-marked-visit-as-rejected/',
  withdrawMarkedVisitAsRejected
);

router.get(
  '/visits-compliance-reports/:companyId',
  authenticateToken,
  getVisitsComplianceReports
);

router.post('/filter-visits/:companyId', authenticateToken, filterVisits);
//visit compliance
router.get(
  '/visits-compliance/:companyId',
  authenticateToken,
  getVisitsCompliance
);

//visits count
router.get('/get-visits-count/:companyId', authenticateToken, getVisitsCount);

// Service types and procedure codes
router.get('/service-types', authenticateToken, getAllServiceTypes);
router.get('/service-type-mapping', authenticateToken, getServiceTypeMapping);

// Predefined activities
router.get(
  '/predefined-activities',
  authenticateToken,
  getPredefinedActivities
);

router.get(
  '/visit-compliance/:companyId/:year',
  authenticateToken,
  getVisitCount
);

export default router;
