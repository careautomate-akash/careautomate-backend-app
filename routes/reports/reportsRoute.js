import express from 'express';
import { getTenantPersonalInfoReports, getServiceTrackingPlanReports, getTenantVisitComplianceReports, getHcmPersonalInfoReports, numberOfTenantsHcms } from '../../controllers/reports/reportsController.js';
import { authenticateToken } from '../../middleware/auth.js';

const router = express.Router();

//tenant reports
router.get('/tenant-personal-info-reports/:companyId', authenticateToken, getTenantPersonalInfoReports);
router.get('/service-tracking-plan-reports/:companyId', authenticateToken, getServiceTrackingPlanReports);
router.get("/tenant-visit-compliance-reports/:companyId", authenticateToken, getTenantVisitComplianceReports);

//hcm reports
router.get("/hcm-personal-info-reports/:companyId", authenticateToken, getHcmPersonalInfoReports);

//admin reports
router.post("/number-of-tenants-hcms/:companyId", authenticateToken, numberOfTenantsHcms);
export default router;

