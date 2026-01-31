import express from 'express';
import {
    getSubscriptionStatus,
    subscribe,
    cancelSubscriptionController,
    reactivateAccountController,
    checkSubscription,
    getSubscriptionDetailsAdmin,
    activateSubscriptionAdmin,
} from '../../controllers/account/subscriptionController.js';
import { authenticateToken } from '../../middleware/auth.js';

const router = express.Router();

// User subscription routes (requires authentication)
router.get('/status', authenticateToken, getSubscriptionStatus);
router.get('/check', authenticateToken, checkSubscription);
router.post('/subscribe', authenticateToken, subscribe);
router.post('/cancel', authenticateToken, cancelSubscriptionController);
router.post('/reactivate', authenticateToken, reactivateAccountController);

// Admin routes (requires authentication and admin role)
router.get('/admin/:userId', authenticateToken, getSubscriptionDetailsAdmin);
router.post('/admin/:userId/activate', authenticateToken, activateSubscriptionAdmin);

export default router;
