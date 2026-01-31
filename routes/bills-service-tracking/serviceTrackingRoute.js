import express from 'express';

import {
  getUnitsRemaining,
  getAllServicesByTenant,
  getAllServices,
  addService,
  getServices,
  editService,
} from '../../controllers/bills-service-tracking/serviceTrackingController.js';
import { getTenantsRunningByUnits } from '../../controllers/bills-service-tracking/billController.js';
import { authenticateToken } from '../../middleware/auth.js';

const router = express.Router();

router.get('/unitsRemaining', authenticateToken, getUnitsRemaining);
router.get(
  '/get-tenants-running-by-units',
  authenticateToken,
  getTenantsRunningByUnits
);
router.post(
  '/get-all-services-by-tenant',
  authenticateToken,
  getAllServicesByTenant
);
router.get('/get-all-services', authenticateToken, getAllServices);

router.post('/add-service', authenticateToken, addService);
router.post('/update-service/:serviceId', authenticateToken, editService);
// router.post("/delete-service", authenticateToken, deleteService);
router.get('/get-all-services/:tenantId', authenticateToken, getServices);
export default router;
