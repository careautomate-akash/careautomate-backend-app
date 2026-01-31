import express from 'express';
import {
  registerController,
  loginController,
  sendVerificationCode,
  forgotPasswordController,
  verifyOTPController,
  changePasswordController,
  changeEmployeeOrMemberPasswordController,
  checkEmailExists,
} from '../../controllers/account/authController.js';
import { authenticateToken } from '../../middleware/auth.js';

//router object
const router = express.Router();
//REGISTER
router.post('/register', registerController);
//LOGIN
router.post('/login', loginController);
router.post(
  '/request-verification-code',
  authenticateToken,
  sendVerificationCode,
);
router.post('/forgot-password', forgotPasswordController);
router.post('/verify-otp', verifyOTPController);
router.post('/change-password', changePasswordController);
router.post(
  '/:userId/change-password',
  changeEmployeeOrMemberPasswordController,
);

router.post('/check-email', authenticateToken, checkEmailExists);

export default router;
