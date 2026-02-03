import express from 'express';
import {
  getCompanyReports,
  updateCompanyData,
  deleteCompany,
  getSuperAdminData,
  getAllVisitsCount,
  getAllAppointmentsCount,
  getAllTenantsCount,
  getCompanyReportForEdit,
} from '../../controllers/account/superAdminController.js';
import { authenticateToken } from '../../middleware/auth.js';
import { superAdminMiddleware } from '../../middleware/superadminmiddleware.js';

const router = express.Router();

// router.get('/get-super-admin-details', authenticateToken, superAdminMiddleware);


//superadmin reports
router.get('/get-company-reports', authenticateToken, superAdminMiddleware, getCompanyReports);
router.get('/get-company-reports/:companyId', authenticateToken, superAdminMiddleware, getCompanyReportForEdit);

//update company data
router.put('/update-company-data/', authenticateToken, superAdminMiddleware, updateCompanyData);

//delete company
router.delete('/delete-company/:companyId', authenticateToken, superAdminMiddleware, deleteCompany);

//superadmin data
router.get(
  '/get-super-admin-data/:adminId',
  authenticateToken,
  superAdminMiddleware,
  getSuperAdminData
);

//visits count of all companies
router.get('/get-all-visits-count', authenticateToken, superAdminMiddleware, getAllVisitsCount);
export default router;

//appointments count of all companies
router.get(
  '/get-all-appointments-count',
  authenticateToken,
  superAdminMiddleware,
  getAllAppointmentsCount
);

//appointments count of all companies
router.get('/get-all-tenants-count', authenticateToken, superAdminMiddleware, getAllTenantsCount);
