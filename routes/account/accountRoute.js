import express from 'express';
import {
  addChildAdminAccount,
  getChildAdminAccounts,
  updateChildAdminAccount,
  deleteChildAdminAccount,
  getSuperAdminDetails,
  officeAdminAccountSetupController,
  fetchAccountDetails,
  updateAccountDetails,
  deleteAccountDetails,
  updateWaystarAccount,
  updateBankingInfo,
  updateMnitsAccount,
  setTimeZoneForaUser,
} from '../../controllers/account/accountController.js';
import { authenticateToken } from '../../middleware/auth.js';

const router = express.Router();

//add child admin account
router.post(
  '/child-admin-account/add-child-admin-account',
  authenticateToken,
  addChildAdminAccount
);

//get child admin account details
router.get(
  '/child-admin-account/get-child-admin-accounts/:adminId',
  authenticateToken,
  getChildAdminAccounts
);

//update child admin account
router.put(
  '/child-admin-account/update-child-admin-account/:id',
  authenticateToken,
  updateChildAdminAccount
);

//delete child admin account
router.delete(
  '/child-admin-account/delete-child-admin-account/:id',
  authenticateToken,
  deleteChildAdminAccount
);

//superadmin details
router.post(
  '/fetch-superadmin-account-details',
  authenticateToken,
  getSuperAdminDetails
);

//office admin account setup
router.post(
  '/office-admin-account-setup',
  authenticateToken,
  officeAdminAccountSetupController
);

//add account personal details
router.post(
  '/add-account-personal-details',
  authenticateToken,
  officeAdminAccountSetupController
);

//fetch account details
router.get(
  '/get-account-personal-details/:adminId',
  authenticateToken,
  fetchAccountDetails
);

//delete account details
router.delete(
  '/delete-account-personal-details',
  authenticateToken,
  deleteAccountDetails
);

//update account details
router.put(
  '/update-account-personal-details',
  authenticateToken,
  updateAccountDetails
);

//WAYSTAR ACCOUNT
router.put(
  '/update-waystar-account/:adminId',
  authenticateToken,
  updateWaystarAccount
);

//BANKING INFO
router.put(
  '/update-banking-info/:adminId',
  authenticateToken,
  updateBankingInfo
);

//MNITS ACCOUNT
router.put(
  '/update-mnits-account/:adminId',
  authenticateToken,
  updateMnitsAccount
);

//Set Time Zone for a User
router.post('/set-timezone-for-user', setTimeZoneForaUser);

export default router;
